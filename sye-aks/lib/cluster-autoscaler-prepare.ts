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
    const name = defaultClusterAutoscalerSpName(options.resourceGroup, options.clusterName)
    const adApplication = await azureSession.createAdApplication(name)
    await azureSession.createServicePrincipal(name, options.servicePrincipalPassword, adApplication)
}
