import { AzureSession } from '../../lib/azure/azure-session'
import { getSubnetName } from './aks-config'
import { getVnetName } from './aks-config'

export async function deleteAksCluster(
    subscription: string | undefined,
    options: {
        resourceGroup: string
        clusterName: string
    }
) {
    const azureSession = await new AzureSession().init({ subscriptionNameOrId: subscription })
    await azureSession.deleteCluster(options.clusterName, options.resourceGroup)
    await azureSession.deleteSubnet(
        options.resourceGroup,
        getSubnetName(options.clusterName),
        getVnetName(options.resourceGroup)
    )
}
