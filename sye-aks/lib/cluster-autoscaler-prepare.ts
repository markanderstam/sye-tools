import { AzureSession } from '../../lib/azure/azure-session'
import { defaultClusterAutoscalerSpName } from './aks-config'

export async function prepareClusterAutoscaler(
    subscriptionNameOrId: string | undefined,
    options: {
        resourceGroup: string
        clusterName: string
        servicePrincipalPassword: string
    }
) {
    const azureSession = await new AzureSession().init({ subscriptionNameOrId })
    const aksCluster = await azureSession
        .containerServiceClient()
        .managedClusters.get(options.resourceGroup, options.clusterName)
    const k8sResourceGroup = aksCluster.nodeResourceGroup
    const name = defaultClusterAutoscalerSpName(options.resourceGroup, options.clusterName)
    const adApplication = await azureSession.createAdApplication(name)
    const servicePrincipal = await azureSession.createServicePrincipal(
        name,
        options.servicePrincipalPassword,
        adApplication
    )
    // Add service principal access to both main and node resource groups
    await azureSession.assignRoleToServicePrincipal(
        servicePrincipal,
        azureSession.getResourceGroupScope(options.resourceGroup),
        azureSession.getRoleDefinitionId(azureSession.CONTRIBUTOR_ROLE_NAME)
    )
    await azureSession.assignRoleToServicePrincipal(
        servicePrincipal,
        azureSession.getResourceGroupScope(k8sResourceGroup),
        azureSession.getRoleDefinitionId(azureSession.CONTRIBUTOR_ROLE_NAME)
    )
}
