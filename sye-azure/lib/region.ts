import NetworkManagementClient = require('azure-arm-network')
import { validateClusterId, getCredentials, getSubscription, subnetName, vnetName } from './common'

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

    // Create security groups
    // TODO
}

export async function regionDelete(_clusterId: string, _region: string): Promise<void> {}
