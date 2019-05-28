import { AzureSession } from '../../lib/azure/azure-session'
import { consoleLog } from '../../lib/common'
import { ManagedCluster } from '@azure/arm-containerservice/esm/models'

async function scaleAksClasicCluster(
    subscription: string | undefined,
    options: {
        resourceGroup: string
        clusterName: string
        nodePoolName: string
        nodePoolSize: number
    },
    aksCluster: ManagedCluster
) {
    consoleLog('Scaling AKS Cluster:')
    const azureSession = await new AzureSession().init({ subscriptionNameOrId: subscription })
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
            return
        }
    }
    consoleLog(`  Failed: Could not find the node pool '${options.nodePoolName}'`)
}

async function scaleAksVmssCluster(
    subscription: string | undefined,
    options: {
        resourceGroup: string
        clusterName: string
        nodePoolName: string
        nodePoolSize: number
        updatePublicIps: boolean
    }
) {
    consoleLog('Scaling AKS Cluster (VMSS):')
    const azureSession = await new AzureSession().init({ subscriptionNameOrId: subscription })
    consoleLog('  Querying the nodepool...')
    const nodePool = await azureSession
        .containerServiceClient()
        .agentPools.get(options.resourceGroup, options.clusterName, options.nodePoolName)
    nodePool.count = options.nodePoolSize
    consoleLog('  Updating the nodepool size...')
    await azureSession
        .containerServiceClient()
        .agentPools.createOrUpdate(options.resourceGroup, options.clusterName, options.nodePoolName, nodePool)
    consoleLog('  Scaling is complete')
}

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
    if (aksCluster.agentPoolProfiles.find((ap) => ap.type === 'VirtualMachineScaleSets')) {
        await scaleAksVmssCluster(subscription, options)
    } else {
        await scaleAksClasicCluster(subscription, options, aksCluster)
    }
}
