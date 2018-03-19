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
import { VirtualMachine, DataDisk } from 'azure-arm-compute/lib/models'
import { exit, syeEnvironmentFile, consoleLog } from '../../lib/common'
import { SecurityRule } from 'azure-arm-network/lib/models'

export async function machineAdd(
    clusterId: string,
    region: string,
    availabilityZone: string,
    machineName: string,
    instanceType: string,
    roles: string[],
    management: boolean,
    storage: number | DataDisk[],
    skipSecurityRules = false,
    profile?: string
) {
    let args = ''
    if (management) {
        args += ' --management eth0'
    }

    let hasStorage = typeof storage === 'number' ? !!storage : storage.length > 0

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
        consoleLog(`WARN: ${machineName} role combination not supported. Using Network Security Group type SINGLE`)
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

    if (hasStorage) {
        if (typeof storage === 'number') {
            vmParameters.storageProfile.dataDisks.push({
                name: dataDiskName(machineName),
                lun: 0,
                diskSizeGB: storage,
                createOption: 'Empty',
                managedDisk: {
                    storageAccountType: 'Premium_LRS',
                },
            })
        } else {
            vmParameters.storageProfile.dataDisks = storage
        }
    }

    let vmInfo = await computeClient.virtualMachines.createOrUpdate(clusterId, machineName, vmParameters)
    debug('vmInfo', vmInfo)
    if (!skipSecurityRules) {
        await ensureMachineSecurityRules(clusterId, profile)
    }
}

export async function machineDelete(
    clusterId: string,
    machineName: string,
    skipSecurityRules = false,
    profile?: string
) {
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
    if (vmInfo.storageProfile) {
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
        await ensureMachineSecurityRules(clusterId, profile)
    }
}

export async function machineRedeploy(clusterId: string, machineName: string, profile?: string) {
    validateClusterId(clusterId)
    const credentials = await getCredentials(profile)
    const subscription = await getSubscription(credentials, { resourceGroup: clusterId })

    const computeClient = new ComputeClient(credentials, subscription.subscriptionId)

    const vmInfo = await computeClient.virtualMachines.get(clusterId, vmName(machineName))

    debug('Power off machine', vmInfo)
    await computeClient.virtualMachines.powerOff(clusterId, vmInfo.name)

    const dataDisks = vmInfo.storageProfile.dataDisks
    if (dataDisks.length > 0) {
        debug('Detach data disks', dataDisks)
        vmInfo.storageProfile.dataDisks = []
        await computeClient.virtualMachines.createOrUpdate(clusterId, vmInfo.name, vmInfo)

        dataDisks.forEach((d) => (d.createOption = 'Attach'))
    }

    debug('Delete machine')
    await machineDelete(clusterId, machineName, true, profile)

    debug('Add machine')
    await machineAdd(
        clusterId,
        vmInfo.location,
        'N/A',
        machineName,
        vmInfo.hardwareProfile.vmSize,
        Object.keys(vmInfo.tags),
        !!vmInfo.tags.management,
        dataDisks,
        false,
        profile
    )
}

export async function ensureMachineSecurityRules(clusterId: string, profile?: string) {
    validateClusterId(clusterId)
    const credentials = await getCredentials(profile)
    const subscription = await getSubscription(credentials, { resourceGroup: clusterId })

    const networkClient = new NetworkManagementClient(credentials, subscription.subscriptionId)
    const computeClient = new ComputeClient(credentials, subscription.subscriptionId)

    const vms = await computeClient.virtualMachines.list(clusterId)
    const ips = new Array<string>()

    for (const vm of vms) {
        if (vm.networkProfile && vm.networkProfile.networkInterfaces) {
            for (const nic of vm.networkProfile.networkInterfaces) {
                const nicName = nic.id.substr(nic.id.lastIndexOf('/') + 1)
                const nicInfo = await networkClient.networkInterfaces.get(clusterId, nicName)
                if (nicInfo.ipConfigurations) {
                    for (const ip of nicInfo.ipConfigurations) {
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
            const rules = new Array<{ type: string; rule: SecurityRule }>()
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
            return setSecurityRules(networkClient, clusterId, group.location, type, rules)
        })
    )
}

async function setSecurityRules(
    networkClient: NetworkManagementClient,
    clusterId: string,
    location: string,
    type: string,
    rules: { type: string; rule: SecurityRule }[]
) {
    for (const def of rules) {
        await networkClient.securityRules.createOrUpdate(
            clusterId,
            securityGroupName(clusterId, location, type),
            securityRuleName(clusterId, location, type, def.type),
            def.rule
        )
    }
}
