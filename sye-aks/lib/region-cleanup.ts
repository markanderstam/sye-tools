import {consoleLog} from '../../lib/common'
import {exec} from './utils'
import {ensureLoggedIn} from './utils'

export interface Context {
    subscriptionArgs: string[],
    resourceGroup: string
    servicePrincipalName: string
    servicePrincipalHomePage: string
}

async function deleteResourceGroup(ctx: Context) {
    try {
        consoleLog(`Check if resource group "${ctx.resourceGroup}" exists:`)
        await exec('az', ['group', 'show',
            ...ctx.subscriptionArgs,
            '--resource-group', ctx.resourceGroup
        ])
        consoleLog('  Deleting...')
        await exec('az', ['group', 'delete',
            ...ctx.subscriptionArgs,
            '--resource-group', ctx.resourceGroup,
            '--yes'
        ])
        consoleLog('  Done.')
    } catch (ex) {
        consoleLog('  Already deleted - OK.')
    }
}

async function deleteServicePrincipal(ctx: Context) {
    try {
        consoleLog(`Check if service principal "${ctx.servicePrincipalName}" exists:`)
        await exec('az', ['ad', 'sp', 'show',
            ...ctx.subscriptionArgs,
            '--id', ctx.servicePrincipalHomePage
        ])
        consoleLog('  Deleting...')
        await exec('az', ['ad', 'sp', 'delete',
            ...ctx.subscriptionArgs,
            '--id', ctx.servicePrincipalHomePage
        ])
        consoleLog('  Done.')
    } catch (ex) {
        consoleLog('  Already deleted - OK.')
    }
}


export async function aksRegionCleanup(subscription: string | undefined, options: {
    resourceGroup: string,
}) {
    const subscriptionArgs = []
    if (subscription) {
        subscriptionArgs.push('--subscription')
        subscriptionArgs.push(subscription)
    }
    const ctx: Context = {
        ...options,
        subscriptionArgs,
        servicePrincipalName: `${options.resourceGroup}-sp`,
        servicePrincipalHomePage: `http://${options.resourceGroup}-sp`
    }
    await ensureLoggedIn()
    await deleteResourceGroup(ctx)
    await deleteServicePrincipal(ctx)
}
