import NetworkManagementClient = require('azure-arm-network')
import ComputeClient = require('azure-arm-compute')
import { validateClusterId, getCredentials, getSubscription, subnetName, vnetName } from './common'
import { machineDelete } from './machine'

export async function regionAdd(clusterId: string, region: string): Promise<void> {
    validateClusterId(clusterId)
    // Create Resource Group
    let credentials = await getCredentials(clusterId)
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
}

export async function regionDelete(clusterId: string, region: string): Promise<void> {
    validateClusterId(clusterId)
    let credentials = await getCredentials(clusterId)
    const subscription = await getSubscription(credentials, { resourceGroup: clusterId })

    const computeClient = new ComputeClient(credentials, subscription.subscriptionId)
    await Promise.all(
        (await computeClient.virtualMachines.list(clusterId))
            .filter((vm) => vm.location === region)
            .map((vm) => machineDelete(clusterId, vm.name))
    )
}
