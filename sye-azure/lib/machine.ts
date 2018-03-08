import * as dbg from 'debug'
const debug = dbg('azure/machine')
import NetworkManagementClient = require('azure-arm-network')
import StorageManagementClient = require('azure-arm-storage')
import { createBlobService, BlobUtilities } from 'azure-storage'

import {
    validateClusterId,
    getCredentials,
    getSubscription,
    vmName,
    publicIpName,
    ipConfigName,
    nicName,
    vnetName,
    subnetName,
    publicContainerName,
    privateContainerName,
    dataDiskName,
    storageAccountName,
    securityGroupName,
    securityRuleName,
    getSecurityGroupType,
    SG_TYPE_FRONTEND_BALANCER,
    SG_TYPE_FRONTEND_BALANCER_MGMT,
    SG_TYPE_MANAGEMENT,
    SG_TYPE_PITCHER,
    SG_TYPE_SINGLE,
    SG_TYPE_DEFAULT,
} from './common'
import ComputeClient = require('azure-arm-compute')
import { VirtualMachine } from 'azure-arm-compute/lib/models'
import { exit, syeEnvironmentFile } from '../../lib/common'

export async function machineAdd(
    profile: string,
    clusterId: string,
    region: string,
    availabilityZone: string,
    machineName: string,
    instanceType: string,
    roles: string[],
    management: boolean,
    storage: number,
    skipSecurityRules = false
) {
    let args = ''
    if (management) {
        args += ' --management eth0'
    }

    let hasStorage = !!storage

    validateClusterId(clusterId)

    let credentials = await getCredentials(profile)

    const subscription = await getSubscription(credentials, { resourceGroup: clusterId })

    const networkClient = new NetworkManagementClient(credentials, subscription.subscriptionId)
    const computeClient = new ComputeClient(credentials, subscription.subscriptionId)
    let subnetInfo = await networkClient.subnets.get(clusterId, vnetName(region), subnetName(region))

    // Check if machine exists before trying to create it
    try {
        let existingVm = await computeClient.virtualMachines.get(clusterId, vmName(machineName))
        debug('existingVm', existingVm)
        exit(`Machine ${machineName} already exists`)
    } catch (e) {
        if (e.code !== 'ResourceNotFound') throw e
    }

    let publicIPParameters = {
        location: region,
        publicIPAllocationMethod: 'Dynamic',
    }

    let publicIPInfo = await networkClient.publicIPAddresses.createOrUpdate(
        clusterId,
        publicIpName(machineName),
        publicIPParameters
    )

    debug('publicIPInfo', publicIPInfo)

    const tags = {}
    if (management) {
        tags['management'] = 'yes'
    }
    roles.forEach((r) => {
        tags[r] = 'yes'
    })

    let nsgType = SG_TYPE_DEFAULT

    let mgmt = tags['management'] === 'yes'
    let fb = tags['frontend-balancer'] === 'yes'
    let pitcher = tags['pitcher'] === 'yes'

    if (pitcher) {
        nsgType = SG_TYPE_PITCHER
    }
    if (mgmt) {
        nsgType = SG_TYPE_MANAGEMENT
    }
    if (fb) {
        nsgType = SG_TYPE_FRONTEND_BALANCER
    }
    if (mgmt && fb) {
        nsgType = SG_TYPE_FRONTEND_BALANCER_MGMT
    }
    if (mgmt && fb && pitcher) {
        nsgType = SG_TYPE_SINGLE
    }
    if ((mgmt && pitcher && !fb) || (fb && pitcher && !mgmt)) {
        nsgType = SG_TYPE_SINGLE
        // tslint:disable-next-line
        console.log(`WARN: ${machineName} role combination not supported. Using Network Security Group type SINGLE`)
    }

    const networkSecurityGroup = await networkClient.networkSecurityGroups.createOrUpdate(
        clusterId,
        securityGroupName(clusterId, region, nsgType),
        {
            location: region,
        }
    )

    // Need to configure SR-IOV here!
    let nicParameters = {
        location: region,
        ipConfigurations: [
            {
                name: ipConfigName(machineName),
                privateIPAllocationMethod: 'Dynamic',
                subnet: subnetInfo,
                publicIPAddress: publicIPInfo,
            },
        ],
        networkSecurityGroup: networkSecurityGroup,
    }

    let networkInterface = await networkClient.networkInterfaces.createOrUpdate(
        clusterId,
        nicName(machineName),
        nicParameters
    )

    debug('networkInterface', networkInterface)

    // let imageInfo = await computeClient.virtualMachineImages.list(region, 'Canonical', 'UbuntuServer', '16.04-LTS', { top: 1 }) // Finds the OLDEST version
    // let version = imageInfo[0].name
    // debug('imageInfo', imageInfo)

    let storageAccount = storageAccountName(subscription.subscriptionId, clusterId)

    let storageClient = new StorageManagementClient(credentials, subscription.subscriptionId)
    let keys = await storageClient.storageAccounts.listKeys(clusterId, storageAccount)
    const blobService = createBlobService(storageAccount, keys.keys[0].value)

    let startDate = new Date()
    startDate.setMinutes(startDate.getMinutes() - 5)
    let expiryDate = new Date()
    expiryDate.setMinutes(expiryDate.getMinutes() + 10)

    var sharedAccessPolicy = {
        AccessPolicy: {
            Permissions: BlobUtilities.SharedAccessPermissions.READ,
            Start: startDate,
            Expiry: expiryDate,
        },
    }
    let sasToken = blobService.generateSharedAccessSignature(
        privateContainerName(),
        syeEnvironmentFile,
        sharedAccessPolicy
    )

    let envUrl = blobService.getUrl(privateContainerName(), syeEnvironmentFile, sasToken, true)
    let publicStorageUrl = blobService.getUrl(publicContainerName())

    const vmParameters: VirtualMachine = {
        location: region,
        tags: tags,
        osProfile: {
            computerName: vmName(machineName),
            adminUsername: 'netinsight',
            adminPassword: 'neti1A', // TODO Remove password
            customData: Buffer.from(
                `#!/bin/sh
cd /tmp
curl -O ${publicStorageUrl}/bootstrap.sh
chmod +x bootstrap.sh
ROLES="${roles}" PUBLIC_STORAGE_URL="${publicStorageUrl}" SYE_ENV_URL="${envUrl}" ATTACHED_STORAGE="${hasStorage}" ./bootstrap.sh --machine-name ${machineName} --machine-region ${region} --machine-zone ${availabilityZone} ${args}
            `
            ).toString('base64'),
        },
        hardwareProfile: {
            vmSize: instanceType,
        },
        storageProfile: {
            imageReference: {
                publisher: 'Canonical',
                offer: 'UbuntuServer',
                sku: '16.04-LTS',
                version: 'latest',
            },
            dataDisks: [],
        },

        networkProfile: {
            networkInterfaces: [
                {
                    id: networkInterface.id,
                    primary: true,
                },
            ],
        },
    }

    if (storage) {
        vmParameters.storageProfile.dataDisks.push({
            name: dataDiskName(machineName),
            lun: 0,
            diskSizeGB: storage,
            createOption: 'Empty',
            managedDisk: {
                storageAccountType: 'Premium_LRS',
            },
        })
    }

    let vmInfo = await computeClient.virtualMachines.createOrUpdate(clusterId, machineName, vmParameters)
    debug('vmInfo', vmInfo)
    if (!skipSecurityRules) {
        await ensureMachineSecurityRules(profile, clusterId)
    }
}

export async function machineDelete(profile: string, clusterId: string, machineName: string, skipSecurityRules = false) {
    validateClusterId(clusterId)

    let credentials = await getCredentials(profile)
    const subscription = await getSubscription(credentials, { resourceGroup: clusterId })

    const networkClient = new NetworkManagementClient(credentials, subscription.subscriptionId)
    const computeClient = new ComputeClient(credentials, subscription.subscriptionId)

    const vmInfo = await computeClient.virtualMachines.get(clusterId, vmName(machineName))
    await computeClient.virtualMachines.deleteMethod(clusterId, vmName(machineName))

    const promises = new Array<Promise<any>>()
    // Delete nics and public IP addresses
    if (vmInfo.networkProfile && vmInfo.networkProfile.networkInterfaces) {
        vmInfo.networkProfile.networkInterfaces.forEach(async (i) => {
            const nicName = i.id.substr(i.id.lastIndexOf('/') + 1)
            const nicInfo = await networkClient.networkInterfaces.get(clusterId, nicName)
            await networkClient.networkInterfaces.deleteMethod(clusterId, nicName)
            if (nicInfo.ipConfigurations) {
                nicInfo.ipConfigurations.forEach((ip) => {
                    const ipName = ip.publicIPAddress.id.substr(ip.publicIPAddress.id.lastIndexOf('/') + 1)
                    promises.push(networkClient.publicIPAddresses.deleteMethod(clusterId, ipName))
                })
            }
        })
    }
    // Delete OS disk and data disk
    if (vmInfo.storageProfile && vmInfo.storageProfile) {
        if (vmInfo.storageProfile.osDisk) {
            promises.push(computeClient.disks.deleteMethod(clusterId, vmInfo.storageProfile.osDisk.name))
        }
        if (vmInfo.storageProfile.dataDisks)
            vmInfo.storageProfile.dataDisks.forEach(async (d) => {
                promises.push(computeClient.disks.deleteMethod(clusterId, d.name))
            })
    }
    await Promise.all(promises)
    await networkClient.networkSecurityGroups.deleteMethod(
        clusterId,
        securityGroupName(clusterId, vmInfo.location, vmInfo.name)
    )
    if (!skipSecurityRules) {
        await ensureMachineSecurityRules(profile, clusterId)
    }
}

export async function machineRedeploy(_profile: string, _clusterId: string, _region: string, _name: string) {
    throw new Error('Not yet implemented!')
}

export async function ensureMachineSecurityRules(profile: string, clusterId: string) {
    validateClusterId(clusterId)
    let credentials = await getCredentials(profile)
    const subscription = await getSubscription(credentials, { resourceGroup: clusterId })

    const networkClient = new NetworkManagementClient(credentials, subscription.subscriptionId)
    const computeClient = new ComputeClient(credentials, subscription.subscriptionId)

    const vms = await computeClient.virtualMachines.list(clusterId)
    const ips = new Array<string>()

    for (let i = 0; i < vms.length; i++) {
        const vm = vms[i]
        if (vm.networkProfile && vm.networkProfile.networkInterfaces) {
            for (let j = 0; j < vm.networkProfile.networkInterfaces.length; j++) {
                const nic = vm.networkProfile.networkInterfaces[j]
                const nicName = nic.id.substr(nic.id.lastIndexOf('/') + 1)
                const nicInfo = await networkClient.networkInterfaces.get(clusterId, nicName)
                if (nicInfo.ipConfigurations) {
                    for (let k = 0; k < nicInfo.ipConfigurations.length; k++) {
                        const ip = nicInfo.ipConfigurations[k]
                        const ipName = ip.publicIPAddress.id.substr(ip.publicIPAddress.id.lastIndexOf('/') + 1)
                        const ipInfo = await networkClient.publicIPAddresses.get(clusterId, ipName)
                        ips.push(ipInfo.ipAddress)
                    }
                }
            }
        }
    }

    const frontendBalancerSecurityRuleDefs = [
        {
            type: 'tcp-frontend-balancer',
            rule: {
                priority: 100,
                access: 'Allow',
                direction: 'inbound',
                sourceAddressPrefix: '*',
                sourcePortRange: '*',
                destinationAddressPrefix: '*',
                destinationPortRanges: ['80', '443'],
                protocol: 'TCP',
            },
        },
    ]

    const managementSecurityRuleDefs = [
        {
            type: 'tcp-management',
            rule: {
                priority: 200,
                access: 'Allow',
                direction: 'inbound',
                sourceAddressPrefix: '*',
                sourcePortRange: '*',
                destinationAddressPrefix: '*',
                destinationPortRanges: ['81', '4433'],
                protocol: 'TCP',
            },
        },
    ]

    const pitcherSecurityRuleDefs = [
        {
            type: 'udp-pitcher',
            rule: {
                priority: 300,
                access: 'Allow',
                direction: 'inbound',
                sourceAddressPrefix: '*',
                sourcePortRange: '*',
                destinationAddressPrefix: '*',
                destinationPortRange: '2123-2130',
                protocol: 'UDP',
            },
        },
    ]

    const defaultSecurityRuleDefs = [
        {
            type: 'ssh-default',
            rule: {
                priority: 1000,
                access: 'Allow',
                direction: 'inbound',
                sourcePortRange: '*',
                sourceAddressPrefix: '*',
                destinationPortRanges: ['22'],
                destinationAddressPrefix: 'VirtualNetwork',
                protocol: 'TCP',
            },
        },
        {
            type: 'cluster-default',
            rule: {
                priority: 1100,
                access: 'Allow',
                direction: 'inbound',
                sourceAddressPrefixes: ips,
                sourcePortRange: '*',
                destinationAddressPrefix: 'VirtualNetwork',
                destinationPortRange: '*',
                protocol: '*',
            },
        },
    ]

    const networkSecurityGroups = await networkClient.networkSecurityGroups.list(clusterId)

    await Promise.all(
        networkSecurityGroups.map((group) => {
            const type = getSecurityGroupType(group.name)
            const rules = []
            rules.push(...defaultSecurityRuleDefs)
            switch (type) {
                case SG_TYPE_FRONTEND_BALANCER:
                    rules.push(...frontendBalancerSecurityRuleDefs)
                    break
                case SG_TYPE_FRONTEND_BALANCER_MGMT:
                    rules.push(...frontendBalancerSecurityRuleDefs)
                    rules.push(...managementSecurityRuleDefs)
                    break
                case SG_TYPE_MANAGEMENT:
                    rules.push(...managementSecurityRuleDefs)
                    break
                case SG_TYPE_PITCHER:
                    rules.push(...pitcherSecurityRuleDefs)
                    break
                case SG_TYPE_SINGLE:
                    rules.push(...frontendBalancerSecurityRuleDefs)
                    rules.push(...managementSecurityRuleDefs)
                    rules.push(...pitcherSecurityRuleDefs)
                    break
            }
            return setSecurityRules(profile, clusterId, group.location, type, rules)
        })
    )
}

export async function setSecurityRules(profile: string, clusterId: string, location: string, type: string, rules: any[]) {
    validateClusterId(clusterId)
    let credentials = await getCredentials(profile)
    const subscription = await getSubscription(credentials, { resourceGroup: clusterId })

    const networkClient = new NetworkManagementClient(credentials, subscription.subscriptionId)
    for (let j = 0; j < rules.length; j++) {
        const def = rules[j]
        await networkClient.securityRules.createOrUpdate(
            clusterId,
            securityGroupName(clusterId, location, type),
            securityRuleName(clusterId, location, type, def.type),
            def.rule
        )
    }
}
