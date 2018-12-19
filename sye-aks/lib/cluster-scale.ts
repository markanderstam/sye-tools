import { AzureSession } from '../../lib/azure/azure-session'
import { consoleLog } from '../../lib/common'
import { ensurePublicIps } from './utils'

export async function scaleAksCluster(
    subscription: string | undefined,
    options: {
        resourceGroup: string
        clusterName: string
        nodePoolName: string
        nodePoolSize: number
        updatePublicIps: boolean
    }
) {
    consoleLog('Scaling AKS Cluster:')
    const azureSession = await new AzureSession().init({ subscriptionNameOrId: subscription })
    consoleLog('  Finding cluster...')
    const aksCluster = await azureSession.getAksCluster(options)
    for (const agentPool of aksCluster.agentPoolProfiles) {
        if (agentPool.name === options.nodePoolName) {
            if (agentPool.count === options.nodePoolSize) {
                consoleLog('  OK - ode pools already has the desired size.')
            } else {
                consoleLog(
                    `  Scaling the node pool ${agentPool.name}: ${agentPool.count} ==> ${options.nodePoolSize}...`
                )
                agentPool.count = options.nodePoolSize
                await azureSession.updateAksCluster(options.clusterName, options.resourceGroup, aksCluster)
                consoleLog('  Scaling is complete')
            }
            if (options.updatePublicIps) {
                await ensurePublicIps(
                    azureSession,
                    options.clusterName,
                    aksCluster.nodeResourceGroup,
                    aksCluster.location
                )
                consoleLog('  Done.')
            }
            return
        }
    }
    consoleLog(`  Failed: Could not find the node pool '${options.nodePoolName}'`)
}
