import NetworkManagementClient = require('azure-arm-network')
import ComputeClient = require('azure-arm-compute')
import {
    validateClusterId,
    getCredentials,
    getSubscription,
    subnetName,
    vnetName,
    securityGroupName,
    SG_TYPES,
} from './common'
import { machineDelete } from './machine'

export async function regionAdd(profile: string, clusterId: string, region: string): Promise<void> {
    validateClusterId(clusterId)
    // Create Resource Group
    let credentials = await getCredentials(profile)
    const subscription = await getSubscription(credentials, { resourceGroup: clusterId })

    // Create VNet
    const networkClient = new NetworkManagementClient(credentials, subscription.subscriptionId)

    var vnetParameters = {
        location: region,
        addressSpace: {
            addressPrefixes: ['10.0.0.0/16'],
        },
        dhcpOptions: {},
        subnets: [{ name: subnetName(region), addressPrefix: '10.0.0.0/24' }],
    }

    await networkClient.virtualNetworks.createOrUpdate(clusterId, vnetName(region), vnetParameters)

    await Promise.all(
        SG_TYPES.map((type) =>
            networkClient.networkSecurityGroups.createOrUpdate(clusterId, securityGroupName(clusterId, region, type), {
                location: region,
            })
        )
    )
}

export async function regionDelete(profile: string, clusterId: string, region: string): Promise<void> {
    validateClusterId(clusterId)
    let credentials = await getCredentials(profile)
    const subscription = await getSubscription(credentials, { resourceGroup: clusterId })

    const computeClient = new ComputeClient(credentials, subscription.subscriptionId)
    await Promise.all(
        (await computeClient.virtualMachines.list(clusterId))
            .filter((vm) => vm.location === region)
            .map((vm) => machineDelete(profile, clusterId, vm.name))
    )

    const networkClient = new NetworkManagementClient(credentials, subscription.subscriptionId)
    await Promise.all(
        SG_TYPES.map((type) =>
            networkClient.networkSecurityGroups.deleteMethod(clusterId, securityGroupName(clusterId, region, type))
        )
    )
}
