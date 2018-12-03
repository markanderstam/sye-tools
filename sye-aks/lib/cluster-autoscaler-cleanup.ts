import { AzureSession } from '../../lib/azure/azure-session'
import { defaultClusterAutoscalerSpName } from './aks-config'

export async function cleanupClusterAutoscaler(p: {
    subscriptionNameOrId?: string
    resourceGroup: string
    clusterName: string
}) {
    const azureSession = await new AzureSession().init({ subscriptionNameOrId: p.subscriptionNameOrId })
    const servicePrincipalName = defaultClusterAutoscalerSpName(p.resourceGroup, p.clusterName)
    await azureSession.deleteServicePrincipal(servicePrincipalName)
    // FIXME: This does not delete anything as far as I can see?
    //await azureSession.deleteRoleDefinition(servicePrincipalName)
}
