import { consoleLog } from '../../lib/common'
import { exec, defaultClusterAutoscalerSpName } from './utils'
import { ensureLoggedIn } from './utils'

async function deleteServicePrincipal(subscriptionArgs: string[], servicePrincipalName: string) {
    consoleLog(`Deleting service principal ${servicePrincipalName}:`)
    await exec('az', ['ad', 'sp', 'delete', ...subscriptionArgs, '--id', `http://${servicePrincipalName}`])
    consoleLog('  Done.')
}

async function deleteRoleDefinition(subscriptionArgs: string[], servicePrincipalName: string) {
    consoleLog(`Deleting role definition ${servicePrincipalName}:`)
    await exec('az', ['role', 'definition', 'delete', ...subscriptionArgs, '--name', servicePrincipalName])
    consoleLog('  Done.')
}

export async function cleanupClusterAutoscaler(
    subscription: string | undefined,
    options: {
        resourceGroup: string
        clusterName: string
    }
) {
    const subscriptionArgs = new Array<string>()
    if (subscription) {
        subscriptionArgs.push('--subscription')
        subscriptionArgs.push(subscription)
    }
    const servicePrincipalName = defaultClusterAutoscalerSpName(options.resourceGroup, options.clusterName)
    await ensureLoggedIn()
    await deleteServicePrincipal(subscriptionArgs, servicePrincipalName)
    await deleteRoleDefinition(subscriptionArgs, servicePrincipalName)
}
