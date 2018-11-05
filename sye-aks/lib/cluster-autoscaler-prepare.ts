import { consoleLog, sleep } from '../../lib/common'
import { exec, defaultClusterAutoscalerSpName } from './utils'
import { ensureLoggedIn } from './utils'

interface Context {
    subscriptionArgs: string[]
    resourceGroup: string
    clusterName: string
    // Derived
    servicePrincipalName: string
    servicePrincipalPassword: string
    servicePrincipalHomePage: string
    k8sResourceGroup: string
}

async function isServicePrincipalCreated(ctx: Context): Promise<boolean> {
    try {
        await exec('az', ['ad', 'sp', 'show', ...ctx.subscriptionArgs, '--id', ctx.servicePrincipalHomePage])
        return true
    } catch (ex) {
        return false
    }
}

async function createServicePrincipal(ctx: Context) {
    consoleLog(`Check if service principal exists:`)
    if (await isServicePrincipalCreated(ctx)) {
        consoleLog('  Already exists - OK.')
    } else {
        consoleLog('  Getting subscription...')
        const subscription = (await exec('az', [
            'account',
            'show',
            ...ctx.subscriptionArgs,
            '--query',
            'id',
            '--output',
            'tsv',
        ]))[0]
        consoleLog('  Creating...')
        await exec('az', [
            'ad',
            'sp',
            'create-for-rbac',
            ...ctx.subscriptionArgs,
            '--name',
            ctx.servicePrincipalName,
            '--password',
            ctx.servicePrincipalPassword,
            '--years',
            '10',
            '--role',
            'Contributor',
            '--scopes',
            `/subscriptions/${subscription}/resourceGroups/${ctx.resourceGroup}`,
            `/subscriptions/${subscription}/resourceGroups/${ctx.k8sResourceGroup}`,
        ])
        consoleLog('  Wait for it to appear...')
        while (!(await isServicePrincipalCreated(ctx))) {
            await sleep(2000)
        }
        consoleLog('  Done.')
    }
}

export async function prepareClusterAutoscaler(
    subscription: string | undefined,
    options: {
        resourceGroup: string
        clusterName: string
        servicePrincipalPassword: string
    }
) {
    const subscriptionArgs = new Array<string>()
    if (subscription) {
        subscriptionArgs.push('--subscription')
        subscriptionArgs.push(subscription)
    }
    const servicePrincipalName = defaultClusterAutoscalerSpName(options.resourceGroup, options.clusterName)
    const ctx: Context = {
        ...options,
        subscriptionArgs,
        servicePrincipalName,
        servicePrincipalHomePage: `http://${servicePrincipalName}`,
        k8sResourceGroup: (await exec('az', [
            'aks',
            'show',
            ...subscriptionArgs,
            '--name',
            options.clusterName,
            '--resource-group',
            options.resourceGroup,
            '-o',
            'tsv',
            '--query',
            'nodeResourceGroup',
        ]))[0],
    }
    await ensureLoggedIn()
    await createServicePrincipal(ctx)
}
