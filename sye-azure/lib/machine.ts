import * as dbg from 'debug'
const debug = dbg('azure/machine')
import { NetworkManagementClient } from '@azure/arm-network'

import {
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
    SG_TYPE_CONNECT_BROKER,
} from '../common'
import { VirtualMachine, DataDisk, VirtualMachineSizeTypes } from '@azure/arm-compute/esm/models'
import { exit, syeEnvironmentFile, consoleLog } from '../../lib/common'
import { SecurityRule } from '@azure/arm-network/esm/models'
import { AzureSession } from '../../lib/azure/azure-session'
import { validateClusterId } from '../common'
import * as Models from '@azure/arm-network/src/models/index'
import { ComputeManagementClient } from '@azure/arm-compute'

export async function machineAdd(
    clusterId: string,
    region: string,
    availabilityZone: string,
    machineName: string,
    instanceType: string,
    roles: string[],
    management: boolean,
    storage: number | DataDisk[],
    skipSecurityRules = false
) {
    let args = ''
    if (management) {
        args += ' --management eth0'
    }

    let hasStorage = typeof storage === 'number' ? !!storage : storage.length > 0

    validateClusterId(clusterId)

    const azureSession = await new AzureSession().init({ resourceGroup: clusterId })

    const networkClient = azureSession.networkManagementClient()
    const computeClient = azureSession.computeManagementClient()
    let subnetInfo = await networkClient.subnets.get(clusterId, vnetName(region), subnetName(region))

    // Check if machine exists before trying to create it
    try {
        let existingVm = await computeClient.virtualMachines.get(clusterId, vmName(machineName))
        debug('existingVm', existingVm)
        exit(`Machine ${machineName} already exists`)
    } catch (e) {
        if (e.code !== 'ResourceNotFound') throw e
    }

    let publicIPParameters: Models.PublicIPAddress = {
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

    const nsgType = getNsgTypeForRoles(roles)

    const networkSecurityGroup = await networkClient.networkSecurityGroups.get(
        clusterId,
        securityGroupName(clusterId, region, nsgType)
    )

    const nicParameters: Models.NetworkInterface = {
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
        enableAcceleratedNetworking: true,
    }

    const networkInterface = await networkClient.networkInterfaces.createOrUpdate(
        clusterId,
        nicName(machineName),
        nicParameters
    )
    debug('networkInterface', networkInterface)

    const storageAccount = storageAccountName(azureSession.currentSubscription.id, clusterId)

    const azureStorageAccount = azureSession.getAzureStorageAccount(clusterId, region, storageAccount)

    const envUrl = await azureStorageAccount.getTemporaryAccessUrl(privateContainerName(), syeEnvironmentFile)
    debug('envUrl', envUrl)
    const publicStorageUrl = azureStorageAccount.getPublicUrl(publicContainerName())

    const storageDeviceName = hasStorage ? '/dev/sdc' : ''

    const vmParameters: VirtualMachine = {
        location: region,
        tags: tags,
        osProfile: {
            computerName: vmName(machineName),
            adminUsername: 'trulive',
            adminPassword: 'neti1A', // TODO Remove password
            customData: Buffer.from(
                `#!/bin/sh
cd /tmp
curl -O ${publicStorageUrl}/bootstrap.sh
chmod +x bootstrap.sh
ROLES="${roles}" PUBLIC_STORAGE_URL="${publicStorageUrl}" SYE_ENV_URL="${envUrl}" STORAGE_DEVICE_NAME="${storageDeviceName}" ./bootstrap.sh --machine-name ${machineName} --machine-region ${region} --machine-zone ${availabilityZone} ${args}
            `
            ).toString('base64'),
        },
        hardwareProfile: {
            vmSize: instanceType as VirtualMachineSizeTypes,
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

    try {
        const vmInfo = await computeClient.virtualMachines.createOrUpdate(clusterId, machineName, vmParameters)
        debug('vmInfo', vmInfo)
    } catch (ex) {
        debug(`Failed to create VM (with accelerated networking): ${ex}`, ex)
        if (ex.code === 'VMSizeIsNotPermittedToEnableAcceleratedNetworking') {
            consoleLog(`Instance type does not support accelerated networking - fallback to standard networking`)

            nicParameters.enableAcceleratedNetworking = false
            debug(`Update NIC ${nicName(machineName)} to be without accelerated networking`, nicParameters)
            const networkInterface = await networkClient.networkInterfaces.createOrUpdate(
                clusterId,
                nicName(machineName),
                nicParameters
            )
            debug('Network interface was updated', networkInterface)
            const vmInfo = await computeClient.virtualMachines.createOrUpdate(clusterId, machineName, vmParameters)
            debug('Virtual machine created (without accelerated networking)', vmInfo)
        } else {
            throw ex
        }
    }
    if (!skipSecurityRules) {
        await ensureMachineSecurityRules(clusterId)
    }
}

export async function machineDelete(clusterId: string, machineName: string, skipSecurityRules = false) {
    validateClusterId(clusterId)

    const azureSession = await new AzureSession().init({ resourceGroup: clusterId })

    const networkClient = azureSession.networkManagementClient()
    const computeClient = azureSession.computeManagementClient()

    const vmInfo = await computeClient.virtualMachines.get(clusterId, vmName(machineName))
    await computeClient.virtualMachines.deleteMethod(clusterId, vmName(machineName))

    const promises = new Array<Promise<any>>()
    // Delete nics and public IP addresses
    if (vmInfo.networkProfile && vmInfo.networkProfile.networkInterfaces) {
        for (const i of vmInfo.networkProfile.networkInterfaces) {
            const nicName = i.id.substr(i.id.lastIndexOf('/') + 1)
            const nicInfo = await networkClient.networkInterfaces.get(clusterId, nicName)
            await networkClient.networkInterfaces.deleteMethod(clusterId, nicName)
            if (nicInfo.ipConfigurations) {
                nicInfo.ipConfigurations.forEach((ip) => {
                    const ipName = ip.publicIPAddress.id.substr(ip.publicIPAddress.id.lastIndexOf('/') + 1)
                    promises.push(networkClient.publicIPAddresses.deleteMethod(clusterId, ipName))
                })
            }
        }
    }
    // Delete OS disk and data disk
    if (vmInfo.storageProfile) {
        if (vmInfo.storageProfile.osDisk) {
            promises.push(computeClient.disks.deleteMethod(clusterId, vmInfo.storageProfile.osDisk.name))
        }
        if (vmInfo.storageProfile.dataDisks)
            vmInfo.storageProfile.dataDisks.forEach((d) => {
                promises.push(computeClient.disks.deleteMethod(clusterId, d.name))
            })
    }
    await Promise.all(promises)
    await networkClient.networkSecurityGroups.deleteMethod(
        clusterId,
        securityGroupName(clusterId, vmInfo.location, vmInfo.name)
    )
    if (!skipSecurityRules) {
        await ensureMachineSecurityRules(clusterId)
    }
}

export async function machineRedeploy(clusterId: string, machineName: string) {
    validateClusterId(clusterId)
    const azureSession = await new AzureSession().init({ resourceGroup: clusterId })

    const computeClient = azureSession.computeManagementClient()

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
    await machineDelete(clusterId, machineName, true)

    debug('Add machine')
    await machineAdd(
        clusterId,
        vmInfo.location,
        'None',
        machineName,
        vmInfo.hardwareProfile.vmSize,
        Object.keys(vmInfo.tags),
        !!vmInfo.tags.management,
        dataDisks,
        false
    )
}

export async function getPublicIpsForCluster(
    clusterId: string,
    computeClient: ComputeManagementClient,
    networkClient: NetworkManagementClient
) {
    const vms = await computeClient.virtualMachines.list(clusterId)
    const ips = new Array<string>()

    for (const vm of vms) {
        if (vm.networkProfile && vm.networkProfile.networkInterfaces) {
            for (const nic of vm.networkProfile.networkInterfaces) {
                const nicName = nic.id.substr(nic.id.lastIndexOf('/') + 1)
                const nicInfo = await networkClient.networkInterfaces.get(clusterId, nicName)
                if (nicInfo.ipConfigurations) {
                    for (const ip of nicInfo.ipConfigurations) {
                        if (!ip.publicIPAddress) {
                            continue
                        }
                        const ipName = ip.publicIPAddress.id.substr(ip.publicIPAddress.id.lastIndexOf('/') + 1)
                        const ipInfo = await networkClient.publicIPAddresses.get(clusterId, ipName)
                        if (ipInfo && ipInfo.ipAddress) {
                            ips.push(ipInfo.ipAddress)
                        } else {
                            exit(
                                `Failed to find public ip-address of vm ${vm.name} interface ${nicName} ip name ${ipName}: ${ipInfo}`
                            )
                        }
                    }
                }
            }
        }
    }
    return ips
}

export async function ensureMachineSecurityRules(clusterId: string, extraResourceGroups?: string[]) {
    validateClusterId(clusterId)
    const azureSession = await new AzureSession().init({ resourceGroup: clusterId })

    const networkClient = azureSession.networkManagementClient()
    const computeClient = azureSession.computeManagementClient()

    const ips = await getPublicIpsForCluster(clusterId, computeClient, networkClient)
    if (extraResourceGroups) {
        for (const extraResourceGroup of extraResourceGroups) {
            if (clusterId === extraResourceGroup) {
                exit(`Extra resource group '${extraResourceGroup}' cannot be the same as the cluster id '${clusterId}'`)
            }
            const ips2 = await getPublicIpsForCluster(extraResourceGroup, computeClient, networkClient)
            ips.push(...ips2)
        }
    }

    const frontendBalancerSecurityRuleDefs: { type: string; rule: SecurityRule }[] = [
        {
            type: 'tcp-frontend-balancer',
            rule: {
                priority: 100,
                access: 'Allow',
                direction: 'Inbound',
                sourceAddressPrefix: '*',
                sourcePortRange: '*',
                destinationAddressPrefix: '*',
                destinationPortRanges: ['80', '443'],
                protocol: 'Tcp',
            },
        },
    ]

    const managementSecurityRuleDefs: { type: string; rule: SecurityRule }[] = [
        {
            type: 'tcp-management',
            rule: {
                priority: 200,
                access: 'Allow',
                direction: 'Inbound',
                sourceAddressPrefix: '*',
                sourcePortRange: '*',
                destinationAddressPrefix: '*',
                destinationPortRanges: ['81', '4433'],
                protocol: 'Tcp',
            },
        },
    ]

    const pitcherSecurityRuleDefs: { type: string; rule: SecurityRule }[] = [
        {
            type: 'udp-pitcher',
            rule: {
                priority: 300,
                access: 'Allow',
                direction: 'Inbound',
                sourceAddressPrefix: '*',
                sourcePortRange: '*',
                destinationAddressPrefix: '*',
                destinationPortRange: '2123-2130',
                protocol: 'Udp',
            },
        },
    ]

    const sshSecurityRuleDefs: { type: string; rule: SecurityRule }[] = [
        {
            type: 'ssh-default',
            rule: {
                priority: 1000,
                access: 'Allow',
                direction: 'Inbound',
                sourcePortRange: '*',
                sourceAddressPrefix: '*',
                destinationPortRanges: ['22'],
                destinationAddressPrefix: 'VirtualNetwork',
                protocol: 'Tcp',
            },
        },
    ]

    const connectBrokerSecurityRuleDefs: { type: string; rule: SecurityRule }[] = [
        {
            type: 'connection-broker',
            rule: {
                priority: 400,
                access: 'Allow',
                direction: 'Inbound',
                sourcePortRange: '*',
                sourceAddressPrefix: '*',
                destinationPortRanges: ['2505'],
                destinationAddressPrefix: 'VirtualNetwork',
                protocol: 'Tcp',
            },
        },
    ]

    const defaultSecurityRuleDefs: { type: string; rule: SecurityRule }[] = [
        {
            type: 'cluster-default',
            rule: {
                priority: 1100,
                access: 'Allow',
                direction: 'Inbound',
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
            rules.push(...sshSecurityRuleDefs)
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
                case SG_TYPE_CONNECT_BROKER:
                    rules.push(...connectBrokerSecurityRuleDefs)
                    break
                case SG_TYPE_SINGLE:
                    rules.push(...frontendBalancerSecurityRuleDefs)
                    rules.push(...managementSecurityRuleDefs)
                    rules.push(...pitcherSecurityRuleDefs)
                    rules.push(...connectBrokerSecurityRuleDefs)
                    break
            }
            return setSecurityRules(networkClient, clusterId, group.location, type, rules)
        })
    )

    if (extraResourceGroups) {
        for (const resourceGroup of extraResourceGroups) {
            consoleLog(`Ensuring security rules for resource group ${resourceGroup}`)
            const sideNetworkSecurityGroups = await networkClient.networkSecurityGroups.list(resourceGroup)
            for (const nsg of sideNetworkSecurityGroups) {
                debug(`Updating network security group: ${nsg.name} in ${resourceGroup}`)
                for (const ruleDef of defaultSecurityRuleDefs) {
                    const ruleName = securityRuleName(resourceGroup, nsg.location, 'side', ruleDef.type)
                    await networkClient.securityRules.createOrUpdate(resourceGroup, nsg.name, ruleName, ruleDef.rule)
                }
            }
        }
    }
}

async function setSecurityRules(
    networkClient: NetworkManagementClient,
    clusterId: string,
    location: string,
    type: string,
    rules: { type: string; rule: SecurityRule }[]
) {
    const nsgName = securityGroupName(clusterId, location, type)
    debug(`Updating network security group: ${nsgName}`)
    for (const def of rules) {
        let ruleName = securityRuleName(clusterId, location, type, def.type)
        debug('Applying rule', { clusterId, nsgName, ruleName, rule: def.rule })
        await networkClient.securityRules.createOrUpdate(clusterId, nsgName, ruleName, def.rule)
    }
}

export async function machineEdit(
    clusterId: string,
    machineName: string,
    removeRoles: string[],
    addRoles: string[]
): Promise<void> {
    debug('args', { clusterId, machineName, removeRoles, addRoles })
    const azureSession = await new AzureSession().init({ resourceGroup: clusterId })
    const vm = await azureSession.computeManagementClient().virtualMachines.get(clusterId, machineName)

    // Remove tags
    for (const role of removeRoles) {
        debug('remove role', { role })
        delete vm.tags[role]
    }

    // Add tags
    for (const role of addRoles) {
        debug('add role', { role })
        vm.tags[role] = 'yes'
    }
    debug('roles updated', { tags: vm.tags })

    // Fetch NIC
    if (vm.networkProfile.networkInterfaces.length !== 1) {
        throw new Error(`VM has ${vm.networkProfile.networkInterfaces.length} NICs -- unsupported`)
    }
    const nicId = vm.networkProfile.networkInterfaces[0].id
    const nicName = nicId.substr(nicId.lastIndexOf('/') + 1)
    const nic = await azureSession.networkManagementClient().networkInterfaces.get(clusterId, nicName)
    const nsgType = getNsgTypeForRoles(Object.getOwnPropertyNames(vm.tags).filter((t) => vm.tags[t] === 'yes'))
    const networkSecurityGroup = await azureSession
        .networkManagementClient()
        .networkSecurityGroups.get(clusterId, securityGroupName(clusterId, vm.location, nsgType))
    nic.networkSecurityGroup = networkSecurityGroup
    debug('Updating NIC', { clusterId, nicName, nic })
    await azureSession.networkManagementClient().networkInterfaces.createOrUpdate(clusterId, nicName, nic)
    debug('Updating VM', { clusterId, machineName, vm })
    await azureSession.computeManagementClient().virtualMachines.createOrUpdate(clusterId, machineName, vm)
}

function getNsgTypeForRoles(roles: string[]): string {
    const pitcher = roles.find((x) => x === 'pitcher')
    const log = roles.find((x) => x === 'log')
    const connectBroker = roles.find((x) => x === 'connect-broker')
    const management = roles.find((x) => x === 'management')
    const frontendBalancer = roles.find((x) => x === 'frontend-balancer')

    if (!pitcher && !log && !connectBroker && !management && !frontendBalancer) {
        return SG_TYPE_DEFAULT
    }
    if (pitcher && !log && !connectBroker && !management && !frontendBalancer) {
        return SG_TYPE_PITCHER
    }
    if (!pitcher && !log && !connectBroker && management && !frontendBalancer) {
        return SG_TYPE_MANAGEMENT
    }
    if (!pitcher && !log && connectBroker && !management && !frontendBalancer) {
        return SG_TYPE_CONNECT_BROKER
    }
    if (!pitcher && !log && !connectBroker && !management && frontendBalancer) {
        return SG_TYPE_FRONTEND_BALANCER
    }
    if (!pitcher && !log && !connectBroker && management && frontendBalancer) {
        return SG_TYPE_FRONTEND_BALANCER_MGMT
    }
    if (pitcher && log && connectBroker && management && frontendBalancer) {
        return SG_TYPE_SINGLE
    }
    consoleLog(`WARN: [${roles.join(', ')}] role combination not supported. Using Network Security Group type SINGLE`)
    return SG_TYPE_SINGLE
}
