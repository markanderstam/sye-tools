import {consoleLog} from '../../lib/common'
import {exec} from './utils'
import {ensureLoggedIn} from './utils'
const debug = require('debug')('aks/cluster-delete')

export interface Context {
    subscriptionArgs: string[],
    resourceGroup: string
    clusterName: string,
    // Derived
    vnetName: string,
    subnetName: string
}

async function deleteSubnet(ctx: Context) {
    try {
        debug('Check if subnet exists', {vnet: ctx.vnetName, subnet: ctx.subnetName})
        await exec('az', ['network', 'vnet', 'subnet', 'show',
            ...ctx.subscriptionArgs,
            '--resource-group', ctx.resourceGroup,
            '--vnet-name', ctx.vnetName,
            '--name', ctx.subnetName
        ])
        consoleLog(`Deleting subnet "${ctx.subnetName}"`)
        await exec('az', ['network', 'vnet', 'subnet', 'delete',
            ...ctx.subscriptionArgs,
            '--resource-group', ctx.resourceGroup,
            '--vnet-name', ctx.vnetName,
            '--name', ctx.subnetName
        ])
        consoleLog(`Subnet "${ctx.subnetName}" was deleted`)
    } catch (ex) {
        consoleLog(`Subnet "${ctx.subnetName}" already deleted`)
    }
}

async function deleteCluster(ctx: Context) {
    try {
        debug('Check if AKS cluster exists', {name: ctx.clusterName})
        await exec('az', ['aks', 'show',
            ...ctx.subscriptionArgs,
            '--resource-group', ctx.resourceGroup,
            '--name', ctx.clusterName
        ])
        consoleLog(`Deleting AKS cluster "${ctx.clusterName}"`)
        await exec('az', ['aks', 'delete',
            ...ctx.subscriptionArgs,
            '--resource-group', ctx.resourceGroup,
            '--name', ctx.clusterName,
            '--yes'
        ])
        consoleLog(`AKS cluster "${ctx.clusterName}" was deleted`)
    } catch (ex) {
        consoleLog(`AKS cluster "${ctx.clusterName}" already deleted`)
    }
}

export async function deleteAksCluster(subscription: string | undefined, options: {
    resourceGroup: string,
    clusterName: string
}) {
    const subscriptionArgs = []
    if (subscription) {
        subscriptionArgs.push('--subscription')
        subscriptionArgs.push(subscription)
    }
    const ctx: Context = {
        ...options,
        subscriptionArgs,
        vnetName: options.resourceGroup,
        subnetName: `${options.clusterName}-subnet`,
    }
    await ensureLoggedIn()
    await deleteCluster(ctx)
    await deleteSubnet(ctx)
}
