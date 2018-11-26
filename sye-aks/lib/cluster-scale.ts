import { ensureLoggedIn } from './utils'
import { consoleLog } from '../../lib/common'
import { exec } from './utils'
import { getAksClusterInfo } from './utils'
import { ensurePublicIps } from './utils'
const debug = require('debug')('aks/cluster-scale')

export interface Context {
    subscriptionArgs: string[]
    resourceGroup: string
    clusterName: string
    nodeCount: number

    // Derived
    vnetName: string
    subnetName: string
    k8sResourceGroup: string
    location: string
}

async function scaleCluster(ctx: Context) {
    consoleLog('Scale cluster:')
    const currentNodeCount = parseInt(
        (await exec('az', [
            'aks',
            'show',
            ...ctx.subscriptionArgs,
            '--resource-group',
            ctx.resourceGroup,
            '--name',
            ctx.clusterName,
            '--query',
            'agentPoolProfiles[].count',
            '--output',
            'tsv',
        ]))[0]
    )
    if (currentNodeCount === ctx.nodeCount) {
        consoleLog('  The cluster already has the correct number of node.')
    } else {
        if (currentNodeCount > ctx.nodeCount) {
            consoleLog(`  Scaling down from ${currentNodeCount} to ${ctx.nodeCount}`)
        } else {
            consoleLog(`  Scaling up from ${currentNodeCount} to ${ctx.nodeCount}`)
        }
        consoleLog('  Resizing the AKS cluster')
        await exec('az', [
            'aks',
            'scale',
            ...ctx.subscriptionArgs,
            '--resource-group',
            ctx.resourceGroup,
            '--name',
            ctx.clusterName,
            '--node-count',
            ctx.nodeCount.toString(),
        ])
        await ensurePublicIps(ctx)
    }
    consoleLog('  Done.')
}

export async function scaleAksCluster(
    subscription: string | undefined,
    options: {
        resourceGroup: string
        clusterName: string
        nodeCount: number
    }
) {
    const subscriptionArgs = []
    if (subscription) {
        subscriptionArgs.push('--subscription')
        subscriptionArgs.push(subscription)
    }
    const info = await getAksClusterInfo({
        subscriptionArgs,
        clusterName: options.clusterName,
        resourceGroup: options.resourceGroup,
    })
    debug('Cluster info', info)
    const ctx: Context = {
        ...options,
        subscriptionArgs,
        vnetName: options.resourceGroup,
        subnetName: `${options.clusterName}-subnet`,
        k8sResourceGroup: info.k8sResourceGroup,
        location: info.location,
    }
    await ensureLoggedIn()
    await scaleCluster(ctx)
}
