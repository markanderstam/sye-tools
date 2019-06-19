import { AzureSession } from '../../lib/azure/azure-session'
import { getSubnetName } from './aks-config'
import { getVnetName } from './aks-config'

export async function deleteAksCluster(
    subscription: string | undefined,
    options: {
        resourceGroup: string
        name: string
    }
) {
    const azureSession = await new AzureSession().init({ subscriptionNameOrId: subscription })
    await azureSession.deleteCluster(options.name, options.resourceGroup)
    await azureSession.deleteSubnet(
        options.resourceGroup,
        getSubnetName(options.name),
        getVnetName(options.resourceGroup)
    )
}
