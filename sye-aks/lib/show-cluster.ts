import { AzureSession } from '../../lib/azure/azure-session'
import { consoleLog } from '../../lib/common'

const debug = require('debug')('sye-aks/show-cluster')

export async function showAksCluster(p: {
    subscriptionNameOrId?: string
    resourceGroup: string
    clusterName: string
}): Promise<void> {
    const azureSession = await new AzureSession().init(p)

    try {
        const cluster = await azureSession.getAksCluster(p)
        for (const agentPoolProfile of cluster.agentPoolProfiles) {
            consoleLog(`  Agent Pool '${agentPoolProfile.name}':`)
            consoleLog(`    VM Size:   '${agentPoolProfile.vmSize}':`)
            consoleLog(`    Count:     '${agentPoolProfile.count}':`)
        }
    } catch (ex) {
        debug('Exception while getting cluster', ex)
        consoleLog(`Did not find any cluster named '${p.clusterName}' in resource group '${p.resourceGroup}'`)
    }
}
