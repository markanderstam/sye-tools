import * as cp from 'child_process'
import { consoleLog } from '../../lib/common'

const debug = require('debug')('aks/utils')

export function exec(
    cmd: string,
    args: string[],
    options: { input?: string; env?: Object; failOnStderr?: boolean } = {}
): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
        let command = cmd
        for (const arg of args) {
            command += ' '
            command += "'"
            command += arg
            command += "'"
        }
        debug(`EXEC: ${command}`, { options })
        const childProcess = cp.exec(command, options, (error, stdout, stderr) => {
            if (error) {
                reject(error.message)
            } else {
                if (stderr && options.failOnStderr) {
                    reject(stderr.toString())
                } else {
                    resolve(stdout.split('\n'))
                }
            }
        })
        if (options.input) {
            childProcess.stdin.write(options.input)
            childProcess.stdin.end()
        }
    })
}

export async function ensureLoggedIn(): Promise<void> {
    try {
        await exec('az', ['account', 'show'])
        debug('Looks as we already have a session with Azure')
    } catch (ex) {
        consoleLog('Log in into Azure')
        await exec('az', ['login'])
    }
}

export function defaultClusterAutoscalerSpName(resourceGroup: string, clusterName: string): string {
    return `${resourceGroup}-${clusterName}-autoscaler`
}

export async function getAksClusterInfo(ctx: {
    subscriptionArgs: string[]
    resourceGroup: string
    clusterName: string
}): Promise<{
    nodeCount: number
    k8sResourceGroup: string
    location: string
}> {
    const info = JSON.parse(
        (await exec('az', [
            'aks',
            'show',
            ...ctx.subscriptionArgs,
            '--resource-group',
            ctx.resourceGroup,
            '--name',
            ctx.clusterName,
        ])).join(' ')
    )
    debug('aks-show', info)
    return {
        nodeCount: info.agentPoolProfiles[0].count,
        k8sResourceGroup: info.nodeResourceGroup,
        location: info.location,
    }
}

export async function ensurePublicIps(ctx: {
    subscriptionArgs: string[]
    clusterName: string
    k8sResourceGroup: string
    location: string
}) {
    consoleLog(`Adding public IPs to VMs in AKS cluster ${ctx.clusterName}:`)
    consoleLog('  Listing VMs...')
    const vmNames = await exec('az', [
        'vm',
        'list',
        ...ctx.subscriptionArgs,
        '--resource-group',
        ctx.k8sResourceGroup,
        '--query',
        '[].name',
        '--output',
        'tsv',
    ])
    const usedPublicIpNames: string[] = []
    for (const vmName of vmNames.filter((x) => !!x)) {
        const publicIpName = `${vmName}-public-ip`
        usedPublicIpNames.push(publicIpName)
        consoleLog(`  Inspecting VM ${vmName}...`)
        try {
            await exec('az', [
                'network',
                'public-ip',
                'show',
                ...ctx.subscriptionArgs,
                '--resource-group',
                ctx.k8sResourceGroup,
                '--name',
                publicIpName,
            ])
            consoleLog(`    Public IP for VM "${vmName}" already exists - OK.`)
        } catch (ex) {
            consoleLog('    Adding public IP...')
            await exec('az', [
                'network',
                'public-ip',
                'create',
                ...ctx.subscriptionArgs,
                '--resource-group',
                ctx.k8sResourceGroup,
                '--location',
                ctx.location,
                '--name',
                publicIpName,
                '--allocation-method',
                'Dynamic',
            ])
            consoleLog('    Finding name of NIC...')
            const nicName = (await exec('az', [
                'vm',
                'nic',
                'list',
                ...ctx.subscriptionArgs,
                '--resource-group',
                ctx.k8sResourceGroup,
                '--vm-name',
                vmName,
                '--query',
                '[].id',
                '--output',
                'tsv',
            ]))[0].replace(/\/.*\//, '')
            debug('nicName', nicName)
            consoleLog('    Finding ipconfiguration...')
            const ipConfigName = (await exec('az', [
                'network',
                'nic',
                'ip-config',
                'list',
                ...ctx.subscriptionArgs,
                '--resource-group',
                ctx.k8sResourceGroup,
                '--nic-name',
                nicName,
                '--query',
                '[] | [?primary].name',
                '--output',
                'tsv',
            ]))[0]
            debug('ipConfigName', ipConfigName)
            consoleLog('    Updating NIC...')
            await exec('az', [
                'network',
                'nic',
                'ip-config',
                'update',
                ...ctx.subscriptionArgs,
                '--resource-group',
                ctx.k8sResourceGroup,
                '--nic-name',
                nicName,
                '--name',
                ipConfigName,
                '--public-ip-address',
                publicIpName,
            ])
            consoleLog('    Public IP Configured - OK.')
        }
    }
    consoleLog('  All VMs have their Public IPs configured')
    consoleLog('  Check for unused public IPs')
    const publicIpNames = await exec('az', [
        'network',
        'public-ip',
        'list',
        ...ctx.subscriptionArgs,
        '--resource-group',
        ctx.k8sResourceGroup,
        '--query',
        '[].name',
        '--output',
        'tsv',
    ])
    for (const publicIpName of publicIpNames) {
        if (usedPublicIpNames.indexOf(publicIpName) == -1 && publicIpName.endsWith('-public-ip')) {
            consoleLog(`  Found unused public ip: ${publicIpName} - deleting it`)
            await exec('az', [
                'network',
                'public-ip',
                'delete',
                ...ctx.subscriptionArgs,
                '--resource-group',
                ctx.k8sResourceGroup,
                '--name',
                publicIpName,
            ])
            consoleLog('  Done')
        }
    }
}
