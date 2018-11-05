import * as aws from 'aws-sdk'
import * as dbg from 'debug'
import { buildTags, tagResource, getTag } from './common'
import { consoleLog, syeEnvironmentFile } from '../../lib/common'
import { getVpcs, getSubnet, getSecurityGroups, efsAvailableInRegion, getElasticFileSystem } from './region'

const debug = dbg('machine')

async function getAmiId(ec2: aws.EC2) {
    let images = await ec2
        .describeImages({
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
                    Values: ['amazon'],
                },
            ],
        })
        .promise()

    let mostRecent = images.Images.sort((a, b) => b.CreationDate.localeCompare(a.CreationDate))[0]

    debug(`Found ami ${mostRecent.ImageId} ${mostRecent.Name}`)
    return mostRecent.ImageId
}

async function getInstanceProfileArn(clusterId: string, type?: string) {
    const instanceProfileName = type ? `${clusterId}-instance-${type}` : `${clusterId}-instance`
    const iam = new aws.IAM()
    const result = await iam
        .getInstanceProfile({
            InstanceProfileName: instanceProfileName,
        })
        .promise()

    return result.InstanceProfile.Arn
}

async function buildUserData(
    clusterId: string,
    roles: string,
    region: string,
    zone: string,
    name: string,
    ebsDeviceName: string,
    fileSystemId: string,
    args = ''
) {
    const s3 = new aws.S3({
        // We need to blank out the region so that the URL generated isn't region specific
        region: '',
    })
    const envUrl = await new Promise((resolve, reject) => {
        s3.getSignedUrl(
            'getObject',
            {
                Bucket: clusterId,
                Key: 'private/' + syeEnvironmentFile,
                Expires: 10 * 60, // The URL will expire after 10 minutes
            },
            (err, url) => {
                if (err) {
                    reject(err)
                }
                resolve(url)
            }
        )
    })
    debug('envUrl', envUrl)
    const efsDns = fileSystemId ? `${fileSystemId}.efs.${region}.amazonaws.com` : ''
    debug('efsDns', efsDns)
    debug('ebsDeviceName', ebsDeviceName)

    let userData = [
        '#!/bin/sh',
        'cd /tmp',
        `aws s3 cp s3://${clusterId}/public/bootstrap.sh bootstrap.sh`,
        'chmod +x bootstrap.sh',
    ]
    let runBootstrap = [
        `ROLES="${roles}"`,
        `BUCKET="${clusterId}"`,
        `SYE_ENV_URL="${envUrl}"`,
        `EBS_DEVICE_NAME="${ebsDeviceName}"`,
        `EFS_DNS="${efsDns}"`,
        `./bootstrap.sh`,
        `--machine-region ${region}`,
        `--machine-zone ${zone} ${args}`,
    ]
    if (name) {
        runBootstrap.push(`--machine-name ${name}`)
    }

    userData.push(runBootstrap.join(' '))

    return Buffer.from(userData.join('\n')).toString('base64')
}

async function createInstanceLaunchSpec(
    ec2: aws.EC2,
    clusterId: string,
    region: string,
    type: 'spot' | 'onDemand',
    name: string,
    availabilityZone: string,
    instanceType: string,
    roles: string[],
    storage: number,
    args: string
): Promise<aws.EC2.RunInstancesRequest | aws.EC2.RequestSpotLaunchSpecification> {
    const vpcid = await getVpcs(ec2, clusterId).then((vpc) => vpc[0].VpcId)
    const sg = await getSecurityGroups(ec2, clusterId, vpcid)
    const subnetId = await getSubnet(ec2, clusterId, availabilityZone).then((subnet) => subnet.SubnetId)
    const amiId = await getAmiId(ec2)
    let instanceProfileArn = await getInstanceProfileArn(clusterId)
    // The scaling machine needs different AWS permissions than just reading the S3 bucket
    if (roles.includes('scaling')) {
        instanceProfileArn = await getInstanceProfileArn(clusterId, 'scaling')
    }

    let groups = [sg.get('sye-default'), sg.get('sye-frontend-balancer'), sg.get('sye-egress-pitcher')]

    // TODO: Use different security-groups for different roles.
    if (roles.includes('management')) {
        groups.push(sg.get('sye-playout-management'))
    }

    let fileSystemId
    if (await efsAvailableInRegion(region)) {
        fileSystemId = await getElasticFileSystem(clusterId, region).then((fs) => (fs ? fs.FileSystemId : undefined))
    } else {
        consoleLog(`EFS not available in region ${region}. /sharedData will not be available.`, true)
    }
    const ebsDeviceName = '/dev/sdf'

    let ec2Req: Partial<aws.EC2.RunInstancesRequest | aws.EC2.RequestSpotLaunchSpecification> = {
        ImageId: amiId,
        InstanceType: instanceType,
        IamInstanceProfile: {
            Arn: instanceProfileArn,
        },
        NetworkInterfaces: [
            {
                DeviceIndex: 0,
                Ipv6AddressCount: 1,
                AssociatePublicIpAddress: true,
                Groups: groups,
                SubnetId: subnetId,
            },
        ],
        UserData: await buildUserData(
            clusterId,
            roles.join(','),
            region,
            availabilityZone,
            name,
            storage > 0 ? ebsDeviceName : '',
            fileSystemId,
            args
        ),
    }

    if (storage > 0) {
        ec2Req.BlockDeviceMappings = [
            {
                DeviceName: ebsDeviceName,
                Ebs: {
                    VolumeSize: storage,
                    VolumeType: 'gp2',
                },
            },
        ]
    }

    if (type === 'onDemand') {
        ec2Req = {
            MinCount: 1,
            MaxCount: 1,
            ...ec2Req,
        }

        if (name) {
            // This instance has a name, so we can tag it when we start it
            ec2Req.TagSpecifications = [
                {
                    ResourceType: 'instance',
                    Tags: buildTags(clusterId, name, {
                        AvailabilityZone: availabilityZone,
                        Roles: roles.join(','),
                    }),
                },
                {
                    ResourceType: 'volume',
                    Tags: buildTags(clusterId, name, {
                        AvailabilityZone: availabilityZone,
                    }),
                },
            ]
        }
    } else if (type === 'spot') {
        ec2Req = {
            Placement: {
                AvailabilityZone: region + availabilityZone,
            },
            ...ec2Req,
        }
    }

    return ec2Req
}

async function createInstance(
    clusterId: string,
    region: string,
    availabilityZone: string,
    name: string,
    instanceType: string,
    storage: number,
    roles: string[],
    args: string
) {
    if (storage > 0 && !name) {
        throw 'A machine with storage must have a name'
    }

    const ec2 = new aws.EC2({ region })
    const ec2Req = (await createInstanceLaunchSpec(
        ec2,
        clusterId,
        region,
        'onDemand',
        name,
        availabilityZone,
        instanceType,
        roles,
        storage,
        args
    )) as aws.EC2.RunInstancesRequest

    let result = await ec2.runInstances(ec2Req).promise()

    let instanceId = result.Instances[0].InstanceId
    debug(instanceId)

    if (!name) {
        // The user did not specify a name for this instance
        // Use the instance-id as a name. Note that this requires
        // us to tag the instance after it has been created.
        name = instanceId
        await tagResource(ec2, instanceId, clusterId, name, {
            AvailabilityZone: availabilityZone,
            Roles: roles.join(','),
        })

        // Note that we cannot tag the ebs volume here, since it does not exist yet
    }
}

async function deleteInstance(clusterId: string, region: string, name: string) {
    const ec2 = new aws.EC2({ region })

    const instance = await getInstance(clusterId, region, name)

    await ec2
        .terminateInstances({
            InstanceIds: [instance.InstanceId],
        })
        .promise()
}

async function redeployInstance(clusterId: string, region: string, name: string) {
    const ec2 = new aws.EC2({ region })

    const instance = await getInstance(clusterId, region, name)

    const dataVolume = instance.BlockDeviceMappings.find((v) => v.DeviceName !== instance.RootDeviceName)
    const dataVolumeId = dataVolume && dataVolume.Ebs.VolumeId

    // Stop existing instance
    if (instance.State !== 'stopped') {
        debug('stopInstance')
        await ec2
            .stopInstances({
                InstanceIds: [instance.InstanceId],
            })
            .promise()
        debug('waitForInstanceStopped')
        await ec2
            .waitFor('instanceStopped', {
                InstanceIds: [instance.InstanceId],
            })
            .promise()
    }

    // Find a volume to get Tags from
    const volume = (await ec2
        .describeVolumes({
            VolumeIds: [dataVolumeId || instance.BlockDeviceMappings[0].Ebs.VolumeId],
        })
        .promise()).Volumes[0]

    if (dataVolumeId !== undefined) {
        // Detach data volume from existing instance
        if (volume.State !== 'available') {
            debug('detachVolume')
            await ec2
                .detachVolume({
                    VolumeId: dataVolumeId,
                })
                .promise()
            debug('waitForVolumeAvailable')
            await ec2
                .waitFor('volumeAvailable', {
                    VolumeIds: [dataVolumeId],
                })
                .promise()
        }
    }

    let fileSystemId
    if (await efsAvailableInRegion(region)) {
        fileSystemId = await getElasticFileSystem(clusterId, region).then((fs) => (fs ? fs.FileSystemId : undefined))
    } else {
        consoleLog(`EFS not available in region ${region}. /sharedData will not be available.`, true)
    }

    // Add new instance
    const amiId = await getAmiId(ec2)
    debug('runInstance')
    const result = await ec2
        .runInstances({
            ImageId: amiId,
            InstanceType: instance.InstanceType,
            IamInstanceProfile: {
                Arn: instance.IamInstanceProfile.Arn,
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
            UserData: await buildUserData(
                clusterId,
                getTag(instance.Tags, 'Roles'),
                region,
                getTag(instance.Tags, 'AvailabilityZone'),
                name,
                dataVolumeId !== undefined ? dataVolume.DeviceName : '',
                fileSystemId
            ),
            TagSpecifications: [
                {
                    ResourceType: 'instance',
                    Tags: instance.Tags,
                },
                {
                    ResourceType: 'volume',
                    Tags: volume.Tags,
                },
            ],
        })
        .promise()

    const instanceId = result.Instances[0].InstanceId
    debug(instanceId)

    if (dataVolumeId !== undefined) {
        // Wait for new instance to be up
        debug('waitForInstanceRunning')
        await ec2
            .waitFor('instanceRunning', {
                InstanceIds: result.Instances.map((i) => i.InstanceId),
            })
            .promise()

        // Attach data volume to new instance
        debug('attachVolume')
        await ec2
            .attachVolume({
                Device: dataVolume.DeviceName,
                InstanceId: instanceId,
                VolumeId: dataVolumeId,
            })
            .promise()

        // Have volume be deleted when instance is terminated
        debug('modifyInstanceAttributeDeleteOnTermination')
        await ec2
            .modifyInstanceAttribute({
                BlockDeviceMappings: [
                    {
                        DeviceName: dataVolume.DeviceName,
                        Ebs: {
                            DeleteOnTermination: true,
                        },
                    },
                ],
                InstanceId: instanceId,
            })
            .promise()
    }

    // Terminate old instance
    debug('terminateInstance')
    await ec2
        .terminateInstances({
            InstanceIds: [instance.InstanceId],
        })
        .promise()
}

export async function getInstances(
    clusterId: string,
    region: string,
    instanceIds: string[],
    names = new Array<string>()
): Promise<aws.EC2.Instance[]> {
    const ec2 = new aws.EC2({ region })

    const describeInstancesRequest: aws.EC2.DescribeInstancesRequest = {
        Filters: [
            {
                Name: 'tag:SyeClusterId',
                Values: [clusterId],
            },
            {
                Name: 'instance-state-name',
                Values: ['pending', 'running', 'stopping', 'stopped'],
            },
        ],
    }

    if (instanceIds[0] !== undefined) {
        describeInstancesRequest.InstanceIds = instanceIds
    }

    if (names[0] !== undefined) {
        describeInstancesRequest.Filters.push({
            Name: 'tag:Name',
            Values: names,
        })
    }

    const instances = await ec2.describeInstances(describeInstancesRequest).promise()

    return instances.Reservations.reduce((acc: aws.EC2.Instance[], current) => { return acc.concat(current.Instances) }, [])
}

export async function getInstance(clusterId: string, region: string, name: string): Promise<aws.EC2.Instance> {
    let instances = await getInstances(clusterId, region, [], [name])

    if (instances.length !== 1) {
        instances = await getInstances(clusterId, region, [name]).catch((err: aws.AWSError) => {
            if (err.code === 'InvalidInstanceID.Malformed') {
                return []
            }
            throw err
        })
    }

    if (instances.length === 0) {
        throw `No instance of '${name}' in ${region} found`
    } else if (instances.length > 1) {
        throw `More than one instance of '${name}' in ${region} found`
    }

    return instances[0]
}

export async function machineAdd(
    clusterId: string,
    region: string, // eu-central-1
    availabilityZone: string, // a
    machineName: string,
    instanceType: string,
    roles: string[],
    management: boolean,
    storage: number
) {
    let args = ''
    if (management) {
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

export async function requestSpotInstances(
    clusterId: string,
    region: string,
    name: string,
    instanceCount: number,
    availabilityZone: string, // a
    instanceType: string,
    spotPrice: string,
    roles: string[],
    storage: number,
    management: boolean
) {
    let args = ''
    if (management) {
        args += ' --management eth0'
    }
    await createSpotInstance(
        clusterId,
        region,
        name,
        instanceCount,
        availabilityZone,
        instanceType,
        spotPrice,
        roles,
        storage,
        args
    )
}

async function createSpotInstance(
    clusterId: string,
    region: string,
    name: string,
    instanceCount: number,
    availabilityZone: string,
    instanceType: string,
    spotPrice: string,
    roles: string[],
    storage: number,
    args: string
) {
    if (name && instanceCount > 1) {
        throw new Error(
            `Cannot have a custom name with more than one instance. Instance count is set to ${instanceCount}`
        )
    }

    const ec2 = new aws.EC2({ region })
    const spotInstanceLaunchSpec = (await createInstanceLaunchSpec(
        ec2,
        clusterId,
        region,
        'spot',
        name,
        availabilityZone,
        instanceType,
        roles,
        storage,
        args
    )) as aws.EC2.RequestSpotLaunchSpecification

    let ec2Request: aws.EC2.RequestSpotInstancesRequest = {
        InstanceCount: instanceCount,
        LaunchSpecification: spotInstanceLaunchSpec,
        SpotPrice: spotPrice,
        Type: 'one-time',
        ValidUntil: new Date(Date.now() + 86400000), // one day
    }

    debug('requestSpotInstances')
    const result = await ec2.requestSpotInstances(ec2Request).promise()
    debug('waitForSpotInstanceRequestFulfilled')
    const fulfilled = await ec2
        .waitFor('spotInstanceRequestFulfilled', {
            SpotInstanceRequestIds: result.SpotInstanceRequests.map((sr) => sr.SpotInstanceRequestId),
        })
        .promise()

    const notFulfilled = fulfilled.SpotInstanceRequests.filter((sr) => sr.Status.Code !== 'fulfilled')
    if (notFulfilled.length > 0) {
        const spotReqs = notFulfilled.map((sr) => {
            return { spotRequestId: sr.SpotInstanceRequestId, status: sr.Status }
        })
        throw new Error(`One or more spot requests was not fulfilled: ${JSON.stringify(spotReqs, null, 2)}`)
    }

    const spotInstancesInfo = fulfilled.SpotInstanceRequests.map((sr) => {
        return { spotRequestId: sr.SpotInstanceRequestId, instanceId: sr.InstanceId, requestStatus: sr.Status.Code }
    })

    debug(spotInstancesInfo)

    // If the user did not specify a name for this instance
    // use the instance-id as a name. Either way this requires
    // us to tag the instance after it has been created.
    await Promise.all(
        spotInstancesInfo.map(async (spotInst) => {
            let instName = name || spotInst.instanceId
            await tagResource(ec2, spotInst.instanceId, clusterId, instName, {
                Region: region,
                AvailabilityZone: availabilityZone,
                Roles: roles.join(','),
            })
        })
    )
    // TODO: Tag the volume with the cluster ID if storage > 0
}
