import { consoleLog, sleep, execSync, readPackageFile } from '../../lib/common'
import { exec } from './utils'
import { ensureLoggedIn } from './utils'
const debug = require('debug')('aks/cluster-autoscaler-setup')

export interface Context {
    subscriptionArgs: string[]
    resourceGroup: string
    location: string
    clusterName: string
    // Derived
    servicePrincipalName: string
    servicePrincipalPassword: string
    servicePrincipalHomePage: string
    kubeconfig: string
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

async function installClusterAutoscalerSecret(ctx: Context) {
    const subscriptionId = (await exec('az', [
        'account',
        'show',
        ...ctx.subscriptionArgs,
        '--query',
        'id',
        '--output',
        'tsv',
    ]))[0]
    const tenantId = (await exec('az', [
        'account',
        'show',
        ...ctx.subscriptionArgs,
        '--query',
        'tenantId',
        '--output',
        'tsv',
    ]))[0]
    const clientId = (await exec('az', [
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
    const secret = `---
apiVersion: v1
kind: Secret
metadata:
  name: cluster-autoscaler-azure
  namespace: kube-system
data:
  ClientID: ${Buffer.from(clientId).toString('base64')}
  ClientSecret: ${Buffer.from(ctx.servicePrincipalPassword).toString('base64')}
  ResourceGroup: ${Buffer.from(ctx.resourceGroup).toString('base64')}
  SubscriptionID: ${Buffer.from(subscriptionId).toString('base64')}
  TenantID: ${Buffer.from(tenantId).toString('base64')}
  VMType: ${Buffer.from('AKS').toString('base64')}
  ClusterName: ${Buffer.from(ctx.clusterName).toString('base64')}
  NodeResourceGroup: ${Buffer.from(ctx.k8sResourceGroup).toString('base64')}
---`
    debug('secret', secret)
    consoleLog(`Installing/updating Cluster Autoscaler Secret:`)
    execSync(`kubectl --kubeconfig ${ctx.kubeconfig} apply -f -`, {
        input: secret,
    })
    consoleLog('  Done.')
}

async function installClusterAutoscaler(ctx: Context) {
    const agentpool = (await exec('kubectl', [
        'get',
        'nodes',
        '-o',
        "jsonpath='{.items[0].metadata.labels.agentpool}'",
    ]))[0]
    debug('agentpool', agentpool)
    consoleLog(`Installing/updating Cluster Autoscaler:`)
    execSync(`kubectl --kubeconfig ${ctx.kubeconfig} apply -f -`, {
        input: readPackageFile('sye-aks/aks-cluster-autoscaler.yaml')
            .toString()
            .replace('${agentpool}', agentpool),
    })
    consoleLog('  Done.')
}

export async function createClusterAutoscaler(
    subscription: string | undefined,
    options: {
        resourceGroup: string
        location: string
        clusterName: string
        servicePrincipalPassword: string
        kubeconfig: string
    }
) {
    const subscriptionArgs = []
    if (subscription) {
        subscriptionArgs.push('--subscription')
        subscriptionArgs.push(subscription)
    }
    const servicePrincipalName = `${options.resourceGroup}-${options.clusterName}-autoscaler`
    const ctx: Context = {
        ...options,
        subscriptionArgs,
        servicePrincipalName,
        servicePrincipalHomePage: `http://${servicePrincipalName}`,
        k8sResourceGroup: `MC_${options.resourceGroup}_${options.clusterName}_${options.location}`,
    }
    await ensureLoggedIn()
    await createServicePrincipal(ctx)
    await installClusterAutoscalerSecret(ctx)
    await installClusterAutoscaler(ctx)
}
