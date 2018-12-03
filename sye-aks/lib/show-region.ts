import { AzureSession } from '../../lib/azure/azure-session'
import { consoleLog } from '../../lib/common'
import { getAksServicePrincipalName } from './aks-config'

const debug = require('debug')('sye-aks/show-cluster')

export async function showAksRegion(p: { subscriptionNameOrId?: string; resourceGroup: string }): Promise<void> {
    const azureSession = await new AzureSession().init(p)

    // Show the resource group
    try {
        const resourceGroup = await azureSession.resourceManagementClient().resourceGroups.get(p.resourceGroup)
        consoleLog(`  Resource Group '${resourceGroup.name}':`)
        consoleLog(`    Location: '${resourceGroup.location}'`)
        consoleLog('    AKS Clusters:')
        let count = 0
        for (const cluster of await azureSession.listAksClusters()) {
            consoleLog(`      ${cluster.name}`)
            count++
        }
        consoleLog(`    (total of ${count} AKS cluster(s)`)
    } catch (ex) {
        debug('Exception', ex)
        consoleLog(`  The Resource Group '${p.resourceGroup}' could not be found`)
    }

    // Show the Service Principal
    const servicePrincipalName = getAksServicePrincipalName(p.resourceGroup)
    try {
        const sp = await azureSession.getServicePrincipal(servicePrincipalName)
        consoleLog(`  Service principal: ${sp.displayName}`)
    } catch (ex) {
        debug('Exception', ex)
        consoleLog(`  Could not find the service principal for the region: ${servicePrincipalName}`)
    }
}
