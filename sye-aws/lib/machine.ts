import * as aws from 'aws-sdk'
import * as dbg from 'debug'
import {buildTags, tagResource, getTag} from './common'
import {getVpc, getSubnet, getSecurityGroups} from './region'

const debug = dbg('machine')

async function getAmiId(ec2: aws.EC2) {
    let images = await ec2.describeImages({
        Filters: [
            {
                Name: 'name',
                Values: ['amzn-ami-*-x86_64-gp2'],
            },
            {
                Name: 'virtualization-type',
                Values: ['hvm'],
            },
            {
                Name: 'owner-alias',
                Values: ['amazon']
            }
        ],
    }).promise()

    let mostRecent = images.Images.sort( (a,b) => b.CreationDate.localeCompare( a.CreationDate ) )[0]

    debug(`Found ami ${mostRecent.ImageId} ${mostRecent.Name}`)
    return mostRecent.ImageId
}

async function getInstanceProfileArn(instanceProfileName: string) {
    let iam = new aws.IAM()
    let result = await iam.getInstanceProfile({
        InstanceProfileName: instanceProfileName + '-instance'
    }).promise()

    return result.InstanceProfile.Arn
}

function buildUserData(clusterId: string, roles: string, region: string, zone: string, name: string, hasStorage: boolean, args = '') {
    const s3 = new aws.S3({
        // We need to blank out the region so that the URL generated isn't region specific
        region: ''
    })
    const envUrl = s3.getSignedUrl('getObject', {
        Bucket: clusterId,
        Key: 'private/sye-environment.tar.gz',
        Expires: 10 * 60 // The URL will expire after 10 minutes
    })
    debug('envUrl', envUrl)
    return Buffer.from(`#!/bin/sh
cd /tmp
aws s3 cp s3://${clusterId}/public/bootstrap.sh bootstrap.sh
chmod +x bootstrap.sh
ROLES="${roles}" BUCKET="${clusterId}" SYE_ENV_URL="${envUrl}" ATTACHED_STORAGE="${hasStorage}" ./bootstrap.sh --machine-name ${name} --machine-region ${region} --machine-zone ${zone} ${args}
`).toString('base64')
}

async function createInstance(
    clusterId: string, region: string, availabilityZone: string,
    name: string, instanceType: string, storage: number, roles: string[], args: string) {

    if( storage > 0 && !name ) {
        throw 'A machine with storage must have a name'
    }

    let ec2 = new aws.EC2({ region })
    let vpcid = await getVpc(ec2, clusterId).then(vpc => vpc.VpcId)
    let sg = await getSecurityGroups(ec2, clusterId, vpcid)
    let subnetId = await getSubnet(ec2, clusterId, availabilityZone).then(subnet => subnet.SubnetId)
    let amiId = await getAmiId(ec2)
    let instanceProfileArn = await getInstanceProfileArn(clusterId)

    let groups = [
        sg.get('sye-default'),
        sg.get('sye-frontend-balancer'),
        sg.get('sye-egress-pitcher')
    ]

    // TODO: Use different security-groups for different roles.
    if (roles.includes('management')) {
        groups.push(sg.get('sye-playout-management'))
    }

    let ec2Req: AWS.EC2.RunInstancesRequest = {
        ImageId: amiId,
        InstanceType: instanceType,
        IamInstanceProfile: {
            Arn: instanceProfileArn
        },
        NetworkInterfaces: [
            {
                DeviceIndex: 0,
                Ipv6AddressCount: 1,
                AssociatePublicIpAddress: true,
                Groups: groups,
                SubnetId: subnetId,
            }
        ],
        MinCount: 1,
        MaxCount: 1,
        UserData: buildUserData(clusterId, roles.join(','), region, availabilityZone, name, !!storage, args)
    }

    if(storage > 0) {
        ec2Req.BlockDeviceMappings = [
            {
                DeviceName: '/dev/sdb',
                Ebs: {
                    VolumeSize: storage,
                    VolumeType: 'gp2' // TODO: Make configurable?
                }
            }
        ]
    }

    if( name ) {
        // This instance has a name, so we can tag it when we start it
        ec2Req.TagSpecifications = [
            {
                ResourceType: 'instance',
                Tags: buildTags(clusterId, name, {
                    AvailabilityZone: availabilityZone,
                    Roles: roles.join(',')
                })
            },
            {
                ResourceType: 'volume',
                Tags: buildTags(clusterId, name, {
                    AvailabilityZone: availabilityZone,
                })
            }
        ]
    }

    let result = await ec2.runInstances( ec2Req ).promise()

    debug(result.Instances[0])
    let instanceId = result.Instances[0].InstanceId

    if( !name ) {
        // The user did not specify a name for this instance
        // Use the instance-id as a name. Note that this requires
        // us to tag the instance after it has been created.
        name = instanceId
        await tagResource(ec2, instanceId, clusterId, name, {
            AvailabilityZone: availabilityZone,
            Roles: roles.join(',')
        })

        // Note that we cannot tag the ebs volume here, since it does not exist yet
    }
}

async function deleteInstance(clusterId: string, region: string, name: string) {
    const ec2 = new aws.EC2({ region })

    const instanceInfo = await getInstanceInformation(clusterId, region, name)

    await ec2.terminateInstances({
        InstanceIds: [instanceInfo.InstanceId]
    }).promise()
}

async function redeployInstance(clusterId: string, region: string, name: string) {
    let ec2 = new aws.EC2({ region })

    const instance = await getInstanceInformation(clusterId, region, name)

    const dataVolume = instance.BlockDeviceMappings.find((v) => v.DeviceName !== instance.RootDeviceName)
    const dataVolumeId = dataVolume && dataVolume.Ebs.VolumeId

    // Stop existing instance
    if (instance.State !== 'stopped') {
        debug('stopInstance')
        await ec2.stopInstances({
            InstanceIds: [instance.InstanceId]
        }).promise()
        debug('waitForInstanceStopped')
        await ec2.waitFor('instanceStopped', {
            InstanceIds: [instance.InstanceId]
        }).promise()
    }

    // Find a volume to get Tags from
    const volume = (await ec2.describeVolumes({
        VolumeIds: [dataVolumeId || instance.BlockDeviceMappings[0].Ebs.VolumeId]
    }).promise()).Volumes[0]

    if (dataVolumeId !== undefined) {
        // Detach data volume from existing instance
        if (volume.State !== 'available') {
            debug('detachVolume')
            await ec2.detachVolume({
                VolumeId: dataVolumeId
            }).promise()
            debug('waitForVolumeAvailable')
            await ec2.waitFor('volumeAvailable', {
                VolumeIds: [dataVolumeId]
            }).promise()
        }
    }

    // Add new instance
    const amiId = await getAmiId(ec2)
    debug('runInstance')
    const result = await ec2.runInstances({
        ImageId: amiId,
        InstanceType: instance.InstanceType,
        IamInstanceProfile: {
            Arn: instance.IamInstanceProfile.Arn
        },
        NetworkInterfaces: instance.NetworkInterfaces.map((nic) => ({
            DeviceIndex: nic.Attachment.DeviceIndex,
            Ipv6AddressCount: nic.Ipv6Addresses.length,
            AssociatePublicIpAddress: true,
            Groups: nic.Groups.map((g) => g.GroupId),
            SubnetId: nic.SubnetId,
        })),
        MinCount: 1,
        MaxCount: 1,
        UserData: buildUserData(clusterId, getTag(instance.Tags, 'Roles'), region, getTag(instance.Tags, 'AvailabilityZone'), name, dataVolumeId !== undefined),
        TagSpecifications: [
            {
                ResourceType: 'instance',
                Tags: instance.Tags
            },
            {
                ResourceType: 'volume',
                Tags: volume.Tags
            }
        ]
    }).promise()
    debug(result.Instances[0])

    if (dataVolumeId !== undefined) {
        // Wait for new instance to be up
        debug('waitForInstanceRunning')
        await ec2.waitFor('instanceRunning', {
            InstanceIds: result.Instances.map((i) => i.InstanceId)
        }).promise()

        // Attach data volume to new instance
        debug('attachVolume')
        await ec2.attachVolume({
            Device: dataVolume.DeviceName,
            InstanceId: result.Instances[0].InstanceId,
            VolumeId: dataVolumeId
        }).promise()

        // Have volume be deleted when instance is terminated
        debug('modifyInstanceAttributeDeleteOnTermination')
        await ec2.modifyInstanceAttribute({
            BlockDeviceMappings: [{
                DeviceName: '/dev/sdb',
                Ebs: {
                    DeleteOnTermination: true
                }
            }],
            InstanceId: result.Instances[0].InstanceId
        }).promise()
    }

    // Terminate old instance
    debug('terminateInstance')
    await ec2.terminateInstances({
        InstanceIds: [instance.InstanceId]
    }).promise()
}

export async function getInstanceInformation(clusterId: string, region: string, name: string): Promise<aws.EC2.Instance | undefined> {
    let ec2 = new aws.EC2({ region })

    let instances = await ec2.describeInstances( {
        Filters: [
            {
                Name: 'tag:SyeClusterId',
                Values: [clusterId]
            },
            {
                Name: 'tag:Name',
                Values: [name]
            },
            {
                Name: 'instance-state-name',
                Values: ['pending', 'running', 'shutting-down', 'stopping', 'stopped']
            }
        ]
    }).promise()

    if( instances.Reservations.length > 1 ) {
        throw `More than one instance of '${name}' in ${region} found`
    }

    if( instances.Reservations.length === 0 ) {
        return undefined
    }

    return instances.Reservations[0].Instances[0]
}

export async function machineAdd(
    clusterId: string,
    region: string,           // eu-central-1
    availabilityZone: string, // a
    machineName: string,
    instanceType: string,
    roles: string[],
    management: boolean,
    storage: number) {
    let args = ''
    if( management ) {
        args += ' --management eth0'
    }
    await createInstance(clusterId, region, availabilityZone, machineName, instanceType, storage, roles, args)
}

export async function machineDelete(clusterId: string, region: string, name: string) {
    await deleteInstance(clusterId, region, name)
}

export async function machineRedeploy(clusterId: string, region: string, name: string) {
    await redeployInstance(clusterId, region, name)
}
