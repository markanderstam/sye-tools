import { AzureSession } from '../../lib/azure/azure-session'
import { getAksServicePrincipalName } from './aks-config'

export async function aksRegionCleanup(
    subscriptionNameOrId: string | undefined,
    options: {
        resourceGroup: string
    }
) {
    const azureSession = await new AzureSession().init({ subscriptionNameOrId: subscriptionNameOrId })
    const servicePrincipalName = getAksServicePrincipalName(options.resourceGroup)
    await azureSession.deleteResourceGroup(options.resourceGroup)
    await azureSession.deleteServicePrincipal(servicePrincipalName)
    await azureSession.deleteAdApplication(servicePrincipalName)
}
