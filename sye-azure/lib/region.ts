import { subnetName, vnetName, securityGroupName, SG_TYPES } from '../common'
import { machineDelete } from './machine'
import { validateClusterId } from '../common'
import { AzureSession } from '../../lib/azure/azure-session'

export async function regionAdd(clusterId: string, region: string): Promise<void> {
    validateClusterId(clusterId)
    const azureSession = await new AzureSession().init({ resourceGroup: clusterId })

    const networkClient = azureSession.networkManagementClient()

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

export async function regionDelete(clusterId: string, region: string): Promise<void> {
    validateClusterId(clusterId)
    const azureSession = await new AzureSession().init({ resourceGroup: clusterId })

    const computeClient = azureSession.computeManagementClient()
    await Promise.all(
        (await computeClient.virtualMachines.list(clusterId))
            .filter((vm) => vm.location === region)
            .map((vm) => machineDelete(clusterId, vm.name, true))
    )

    const networkClient = azureSession.networkManagementClient()
    await networkClient.virtualNetworks.deleteMethod(clusterId, vnetName(region))
    await Promise.all(
        SG_TYPES.map((type) =>
            networkClient.networkSecurityGroups.deleteMethod(clusterId, securityGroupName(clusterId, region, type))
        )
    )
}
