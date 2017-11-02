import * as aws from 'aws-sdk'
import * as dbg from 'debug'
import {tagResource, sleep, consoleLog} from './common'
import {cidrSubset6} from './cidr'
import {getResources} from './cluster'

const debug = dbg('region')

type SecurityGroups = Map<string, string>
interface CoreSubnet {
    id: string
    name: string
    ipv6block?: string
}
interface CoreRegion {
    ec2: aws.EC2
    location: string
    vpcId: string
    subnets: CoreSubnet[]
    securityGroups: SecurityGroups
}

// There seems to be a limit of max 5 VPCs per region
async function createVPC(ec2: aws.EC2, clusterId: string, cidrBlock: string) {
    debug('createVPC', clusterId)
    let result = await ec2.createVpc({
        CidrBlock: cidrBlock,
        AmazonProvidedIpv6CidrBlock: true
    }).promise()
    await tagResource(ec2, result.Vpc.VpcId, clusterId, clusterId)

    let vpc = result.Vpc
    let vpcid = vpc.VpcId

    while (vpc.Ipv6CidrBlockAssociationSet[0].Ipv6CidrBlockState.State !== 'associated') {
        await sleep(2000)
        let result2 = await ec2.describeVpcs({
            VpcIds: [vpcid]
        }).promise()
        vpc = result2.Vpcs[0]
    }

    return vpc
}

async function getAvailabilityZones(ec2: aws.EC2) {
    let availabilityZones = await ec2.describeAvailabilityZones().promise()

    return availabilityZones.AvailabilityZones.map( az => az.ZoneName.slice(-1) )
}

async function createSubnet(ec2: aws.EC2, clusterId: string, name: string, vpcid: string, availabilityZone: string, ipv4cidr: string, ipv6cidr: string) {
    debug('createSubnet', name, ipv4cidr, ipv6cidr)
    let result = await ec2.createSubnet(
        {
            VpcId: vpcid,
            CidrBlock: ipv4cidr,
            Ipv6CidrBlock: ipv6cidr,
            AvailabilityZone: availabilityZone,
        }).promise()
    await tagResource(ec2, result.Subnet.SubnetId, clusterId, name)
    await ec2.modifySubnetAttribute({
        SubnetId: result.Subnet.SubnetId,
        MapPublicIpOnLaunch: { Value: true },
    })

    return result.Subnet
}

async function createInternetGateway(ec2: aws.EC2, clusterId: string, name: string, vpcid: string) {
    debug('createInternetGateway', name, vpcid)
    let result = await ec2.createInternetGateway().promise()
    await tagResource(ec2, result.InternetGateway.InternetGatewayId, clusterId, name)

    await ec2.attachInternetGateway( {
        VpcId: vpcid,
        InternetGatewayId: result.InternetGateway.InternetGatewayId
    }).promise()

    return result.InternetGateway.InternetGatewayId
}

async function setupRouteTable(ec2: aws.EC2, clusterId: string, vpcid: string, gatewayid: string) {
    debug('setupRouting', vpcid)
    let result = await ec2.createRouteTable({
        VpcId: vpcid
    }).promise()
    let routeTableId = result.RouteTable.RouteTableId
    tagResource(ec2, routeTableId, clusterId, 'sye-cluster-route-table')
    await ec2.createRoute({
        RouteTableId: routeTableId,
        DestinationCidrBlock: '0.0.0.0/0',
        GatewayId: gatewayid,
    }).promise()
    await ec2.createRoute({
        RouteTableId: routeTableId,
        DestinationIpv6CidrBlock: '::/0',
        GatewayId: gatewayid,
    }).promise()

    return routeTableId
}

async function associateRouteTable(ec2: aws.EC2, subnetid: string, routeTableId) {
    await ec2.associateRouteTable({
        SubnetId: subnetid,
        RouteTableId: routeTableId
    }).promise()
}

async function createSecurityGroups(ec2: aws.EC2, clusterId: string, vpcid: string) {
    debug('createSecurityGroups', vpcid)

    await createSecurityGroup(ec2, clusterId, vpcid, 'sye-default', [
        {
            IpProtocol: 'tcp',
            FromPort: 22,
            ToPort: 22,
            IpRanges: [
                { CidrIp: '0.0.0.0/0' }
            ],
        }
    ])

    await createSecurityGroup(ec2, clusterId, vpcid, 'sye-egress-pitcher', [
        {
            IpProtocol: 'udp',
            FromPort: 2123,
            ToPort: 2123,
            IpRanges: [
                { CidrIp: '0.0.0.0/0' }
            ],
        }
    ])

    await createSecurityGroup(ec2, clusterId, vpcid, 'sye-frontend-balancer', [
        {
            IpProtocol: 'tcp',
            FromPort: 80,
            ToPort: 80,
            IpRanges: [
                { CidrIp: '0.0.0.0/0' }
            ],
        },
        {
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 443,
            IpRanges: [
                { CidrIp: '0.0.0.0/0' }
            ],
        }
    ])

    await createSecurityGroup(ec2, clusterId, vpcid, 'sye-playout-management', [
        {
            IpProtocol: 'tcp',
            FromPort: 81,
            ToPort: 81,
            IpRanges: [
                { CidrIp: '0.0.0.0/0' }
            ],
        },
        {
            IpProtocol: 'tcp',
            FromPort: 4433,
            ToPort: 4433,
            IpRanges: [
                { CidrIp: '0.0.0.0/0' }
            ],
        }
    ])
}

async function createSecurityGroup(ec2: aws.EC2, clusterId: string, vpcid: string, groupName: string, ipPermissions: aws.EC2.IpPermissionList) {
    debug('createSecurityGroup', groupName)
    const securityGroup = await ec2.createSecurityGroup({
        VpcId: vpcid,
        GroupName: groupName,
        Description: groupName.replace(/^sye-/, '')
    }).promise()

    await tagResource(ec2, securityGroup.GroupId, clusterId, groupName)

    await ec2.authorizeSecurityGroupIngress({
        GroupId: securityGroup.GroupId,
        IpPermissions: ipPermissions
    }).promise()
}

async function getCoreRegion(clusterId: string): Promise<CoreRegion|undefined> {
    debug('getCoreRegion')
    let resources = await getResources(clusterId)
    let ec2: aws.EC2
    let vpcId: string
    let location: string
    let subnets = await Promise.all<CoreSubnet>(
        resources
            .filter(r => r.ResourceARN.startsWith('arn:aws:ec2') &&
                r.ResourceARN.split('/')[1].startsWith('subnet') &&
                r.Tags.some(tag => tag.Key.startsWith('SyeCore_'))
            )
            .map(async (r) => {
                location = r.ResourceARN.split(':')[3]
                ec2 = new aws.EC2({ region: location })
                let id = r.ResourceARN.split('/')[1]
                let name = r.Tags.find(tag => tag.Key === 'Name').Value
                let availabilityZone = name.split('-').pop()
                let subnet = await getSubnet(ec2, clusterId, availabilityZone)
                vpcId = subnet.VpcId
                let ipv6block = subnet.Ipv6CidrBlockAssociationSet[0].Ipv6CidrBlock
                return { id, name, ipv6block }
            })
    )
    if (subnets.length > 0) {
        const securityGroups = await getSecurityGroups(ec2, clusterId, vpcId)
        const coreRegion = { ec2, location, vpcId, subnets, securityGroups }
        debug('core region ', coreRegion)
        return coreRegion
    } else {
        return undefined
    }
}

async function ensureCoreRegion(ec2: aws.EC2, clusterId: string, subnets: CoreSubnet[]) {
    debug('ensureCoreRegion')
    let coreRegion = await getCoreRegion(clusterId)
    if (coreRegion) {
        debug('core region already exists')
        return coreRegion
    } else {
        debug('tag core region')
        let extraTags = {}
        extraTags[`SyeCore_${clusterId}`] = ''
        await Promise.all(
            subnets.map(subnet => tagResource(ec2, subnet.id, clusterId, subnet.name, extraTags))
        )
        return getCoreRegion(clusterId)
    }
}

export async function getVpc(ec2: aws.EC2, clusterId: string) {
    let result = await ec2.describeVpcs({
        Filters: [
            {
                Name: 'tag-key',
                Values: [`SyeCluster_${clusterId}`]
            }
        ]
    }).promise()
    if (result.Vpcs.length === 1) {
        return result.Vpcs[0]
    }
    else {
        throw `Expected 1 vpc, found ${result.Vpcs.length}`
    }
}

export async function getSubnet(ec2: aws.EC2, clusterId: string, availabilityZone: string) {
    let result = await ec2.describeSubnets( {
        Filters: [
            {
                Name: 'tag:Name',
                Values: [clusterId + '-' + availabilityZone]
            }
        ]
    }).promise()

    if (result.Subnets.length === 1) {
        return result.Subnets[0]
    }
    else {
        throw `Expected 1 subnet, found ${result.Subnets.length}`
    }
}

export async function getSecurityGroups(ec2: aws.EC2, clusterId: string, vpcid: string) {
    let result = await ec2.describeSecurityGroups( {
        Filters: [
            {
                Name: 'tag:SyeClusterId',
                Values: [clusterId]
            },
            {
                Name: 'vpc-id',
                Values: [vpcid]
            }
        ]
    }).promise()

    let sgIds: SecurityGroups = new Map()
    result.SecurityGroups.forEach(sg => sgIds.set(sg.GroupName, sg.GroupId))
    return sgIds
}

// Update security group firewall rule to allow inbound IPv6 traffic
async function allowInboundIPv6Traffic(ec2: aws.EC2, clusterId: string, groupName: string, subnets: CoreSubnet[]) {
    debug('allowInboundIPv6Traffic')
    const vpc = await getVpc(ec2, clusterId)
    const securityGroups = await getSecurityGroups(ec2, clusterId, vpc.VpcId)
    await Promise.all(
        subnets.map(subnet => {
            debug('authorizeSecurityGroupRule', subnet.name)
            return ec2.authorizeSecurityGroupIngress({
                GroupId: securityGroups.get(groupName),
                IpPermissions: [
                    {
                        IpProtocol: '-1',
                        Ipv6Ranges: [
                            { CidrIpv6: subnet.ipv6block }
                        ]
                    }
                ]
            }).promise()
        })
    )
}

export async function regionAdd(clusterId: string, region: string) {
    const ec2 = new aws.EC2({ region })

    let availabilityZones = await getAvailabilityZones(ec2)
    let vpc = await createVPC(ec2, clusterId, '10.0.0.0/16')
    let internetGatewayId = await createInternetGateway(ec2, clusterId, clusterId, vpc.VpcId)
    let routeTableId = await setupRouteTable(ec2, clusterId, vpc.VpcId, internetGatewayId)
    let ipv6blockVpc = vpc.Ipv6CidrBlockAssociationSet[0].Ipv6CidrBlock
    consoleLog('Creating subnets in availability-zones ' + availabilityZones.join(', '))
    const subnets = await Promise.all<CoreSubnet>(
        availabilityZones.map(async (availabilityZone, index) => {
            let name = clusterId + '-' + availabilityZone
            let ipv4block = '10.0.' + (index * 16) + '.0/20'
            let ipv6block = cidrSubset6(ipv6blockVpc, index)
            let subnet = await createSubnet(ec2, clusterId, name, vpc.VpcId, region + availabilityZone, ipv4block, ipv6block)
            await associateRouteTable(ec2, subnet.SubnetId, routeTableId)
            return { id: subnet.SubnetId, name, ipv6block }
        })
    )

    await createSecurityGroups(ec2, clusterId, vpc.VpcId)

    /*
     * Only allow IPv6 traffic within cluster regions
     * From core region to and from other regions
     */
    let coreRegion = await ensureCoreRegion(ec2, clusterId, subnets)
    let p = [ allowInboundIPv6Traffic(coreRegion.ec2, clusterId, 'sye-default', subnets) ]
    if (region !== coreRegion.location) {
        p.push( allowInboundIPv6Traffic(ec2, clusterId, 'sye-default', coreRegion.subnets) )
    }
    await Promise.all(p)

}

export async function regionDelete(clusterId: string, region: string) {
    const ec2 = new aws.EC2({ region })
    const coreRegion = await getCoreRegion(clusterId)
    const someTag = (tags: aws.EC2.Tag[], key: string, value: string) =>
        tags.some((tag) => tag.Key === key && tag.Value === value)

    debug('describeVpcs')
    const vpcs = await ec2.describeVpcs().promise()
    const vpc = vpcs.Vpcs.find((vpc) => someTag(vpc.Tags, 'Name', clusterId))

    if (vpc === undefined) {
        debug('vpc does not exist')
        return
    }

    debug('describeSecurityGroups')
    const securityGroups = await ec2.describeSecurityGroups().promise()
    await Promise.all(
        securityGroups.SecurityGroups
            .filter((s) => s.VpcId === vpc.VpcId && s.GroupName.startsWith('sye-'))
            .map((s) => {
                debug('deleteSecurityGroup', s.GroupName)
                return ec2.deleteSecurityGroup({GroupId: s.GroupId}).promise()
            })
    )

    debug('describeSubnets')
    const subnets = await ec2.describeSubnets().promise()
    await Promise.all(
        subnets.Subnets
            .filter((s) => s.VpcId === vpc.VpcId)
            .map(async (s) => {
                const p = []
                if (coreRegion !== undefined && region !== coreRegion.location) {
                    debug('revokeSecurityGroupRule sye-default IPv6 firewall rule on core region')
                    p.push(
                        coreRegion.ec2.revokeSecurityGroupIngress({
                            GroupId: coreRegion.securityGroups.get('sye-default'),
                            IpPermissions: [
                                {
                                    IpProtocol: '-1',
                                    Ipv6Ranges: [
                                        { CidrIpv6: s.Ipv6CidrBlockAssociationSet[0].Ipv6CidrBlock }
                                    ]
                                }
                            ]
                        }).promise()
                    )
                }
                debug('deleteSubnet', s.SubnetId)
                p.push(ec2.deleteSubnet({ SubnetId: s.SubnetId }).promise())
                return Promise.all(p)
            })
    )

    debug('describeInternetGateways')
    const internetGateways = await ec2.describeInternetGateways().promise()
    await Promise.all(
        internetGateways.InternetGateways
            .filter((g) => (g.Attachments[0] || {}).VpcId === vpc.VpcId)
            .map(async (g) => {
                debug('detachInternetGateway', g.InternetGatewayId, vpc.VpcId)
                await ec2.detachInternetGateway({
                    InternetGatewayId: g.InternetGatewayId,
                    VpcId: vpc.VpcId
                }).promise()
                debug('deleteInternetGateway', g.InternetGatewayId)
                return ec2.deleteInternetGateway({InternetGatewayId: g.InternetGatewayId}).promise()
            })
    )

    debug('describeRouteTables')
    const routeTables = await ec2.describeRouteTables().promise()
    await Promise.all(
        routeTables.RouteTables
            .filter((r) => r.VpcId === vpc.VpcId && someTag(r.Tags, 'SyeClusterId', clusterId))
            .map(async (r) => {
                debug('deleteRouteTable', r.RouteTableId)
                return ec2.deleteRouteTable({RouteTableId: r.RouteTableId}).promise()
            })
    )

    debug('deleteVPC', clusterId)
    await ec2.deleteVpc({
        VpcId: vpc.VpcId
    }).promise()
}
