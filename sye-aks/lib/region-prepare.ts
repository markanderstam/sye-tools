import { consoleLog } from '../../lib/common'
import { exec } from './utils'
import { ensureLoggedIn } from './utils'
import { sleep } from '../../lib/common'
const debug = require('debug')('aks/region-prepare')

export interface Context {
    subscriptionArgs: string[]
    resourceGroup: string
    location: string
    servicePrincipalName: string
    servicePrincipalPassword: string
    servicePrincipalHomePage: string
    vnetName: string
    vnetCidr: string
}

async function createResourceGroup(ctx: Context) {
    try {
        consoleLog(`Resource group ${ctx.resourceGroup}:`)
        await exec('az', ['group', 'show', ...ctx.subscriptionArgs, '--resource-group', ctx.resourceGroup])
        consoleLog('  Already exists - OK.')
    } catch (ex) {
        consoleLog('  Creating...')
        await exec('az', [
            'group',
            'create',
            ...ctx.subscriptionArgs,
            '--resource-group',
            ctx.resourceGroup,
            '--location',
            ctx.location,
            '--name',
            ctx.resourceGroup,
        ])
        consoleLog('  Done.')
    }
}

async function createVnet(ctx: Context) {
    try {
        consoleLog(`Virtual network ${ctx.vnetName}:`)
        await exec('az', [
            'network',
            'vnet',
            'show',
            ...ctx.subscriptionArgs,
            '--resource-group',
            ctx.resourceGroup,
            '--name',
            ctx.vnetName,
        ])
        consoleLog('  Already exists - OK.')
    } catch (ex) {
        consoleLog('  Creating...')
        await exec('az', [
            'network',
            'vnet',
            'create',
            ...ctx.subscriptionArgs,
            '--resource-group',
            ctx.resourceGroup,
            '--location',
            ctx.location,
            '--name',
            ctx.vnetName,
            '--address-prefixes',
            ctx.vnetCidr,
        ])
        consoleLog('  Done.')
    }
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
            '--skip-assignment',
        ])
        consoleLog('  Wait for it to appear...')
        while (!(await isServicePrincipalCreated(ctx))) {
            await sleep(2000)
        }
        consoleLog('  Done.')
    }
}

async function assignRoleToServicePrincipal(ctx: Context) {
    consoleLog('Role for service principal:')
    consoleLog('  Getting appId...')
    const appId = (await exec('az', [
        'ad',
        'sp',
        'show',
        ...ctx.subscriptionArgs,
        '--id',
        ctx.servicePrincipalHomePage,
        '--query',
        'appId',
        '--output',
        'tsv',
    ]))[0]
    debug('appId', appId)
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
    const scope = `/subscriptions/${subscription}/resourceGroups/${
        ctx.resourceGroup
    }/providers/Microsoft.Network/virtualNetworks/${ctx.vnetName}`
    debug('scope', scope)
    consoleLog('  Getting existing roles...')
    const roles = JSON.parse(
        (await exec('az', [
            'role',
            'assignment',
            'list',
            '--assignee',
            appId,
            '--scope',
            scope,
            '--resource-group',
            '',
        ])).join(' ')
    )
    debug('roles', roles)
    if (roles.length == 0) {
        consoleLog('  Creating role...')
        let retries = 0
        let done = false
        while (!done) {
            try {
                await exec('az', [
                    'role',
                    'assignment',
                    'create',
                    ...ctx.subscriptionArgs,
                    '--role',
                    'Contributor',
                    '--assignee',
                    appId,
                    '--scope',
                    scope,
                    '--resource-group',
                    '',
                ])
                done = true
            } catch (ex) {
                debug('Role assignment failed', { ex })
                if (!ex.toString().indexOf('does not exist in the directory')) {
                    throw ex
                }
                if (retries++ < 20) {
                    await sleep(6000)
                    consoleLog(`    Service principal not ready - retrying (retry #${retries})...`)
                } else {
                    throw ex
                }
            }
        }
        consoleLog('  Done.')
    } else {
        consoleLog('  Role already exists - OK.')
    }
}

export async function aksRegionPrepare(
    subscription: string | undefined,
    options: {
        resourceGroup: string
        location: string
        vnetCidr: string
        servicePrincipalPassword: string
    }
) {
    const subscriptionArgs = []
    if (subscription) {
        subscriptionArgs.push('--subscription')
        subscriptionArgs.push(subscription)
    }
    const ctx: Context = {
        ...options,
        subscriptionArgs,
        servicePrincipalName: `${options.resourceGroup}-sp`,
        servicePrincipalHomePage: `http://${options.resourceGroup}-sp`,
        vnetName: options.resourceGroup,
    }
    await ensureLoggedIn()
    await createResourceGroup(ctx)
    await createVnet(ctx)
    await createServicePrincipal(ctx)
    await assignRoleToServicePrincipal(ctx)
}
