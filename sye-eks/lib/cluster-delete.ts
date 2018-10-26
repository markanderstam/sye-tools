import * as aws from 'aws-sdk'
import { consoleLog, awaitAsyncCondition, execSync, exit } from '../../lib/common'
import { saveKubeconfigToFile } from './utils'
import { unlinkSync } from 'fs'

async function ensureNoLoadBalancer(awsConfig: aws.Config, clusterName: string) {
    const kubeConfigFile = `./.tmp.${clusterName}.yaml`
    consoleLog(`Deleting NGINX Ingress:`)
    await saveKubeconfigToFile(awsConfig, clusterName, kubeConfigFile)
    try {
        execSync(
            `kubectl --kubeconfig ${kubeConfigFile} delete --namespace kube-system svc nginx-ingress-controller 2>&1`
        )
        consoleLog('  Done.')
    } catch (err) {
        consoleLog('  Already deleted - OK.')
    }
    const services = execSync(
        `kubectl --kubeconfig ${kubeConfigFile} get svc --all-namespaces -o jsonpath=\'{range .items[?(@.spec.type=="LoadBalancer")]}{.metadata.name}{" "}{end}\'`
    )
        .toString()
        .trim()
    if (services.length > 0) {
        exit(`Aborting cluster delete due the following load balancer backed service(s): ${services}`)
    }
    unlinkSync(kubeConfigFile)
}

async function deleteCfStack(awsConfig: aws.Config, stackName: string) {
    const cloudformation = new aws.CloudFormation({ ...awsConfig, apiVersion: '2010-05-15' })
    consoleLog(`Deleting Cloudformation stack "${stackName}":`)
    try {
        await cloudformation.deleteStack({ StackName: stackName }).promise()
    } catch (err) {
        throw err
    }
    consoleLog('  Deleting...')
    try {
        await cloudformation.waitFor('stackDeleteComplete', { StackName: stackName }).promise()
    } catch (err) {
        throw new Error(`Failed to delete EKS stack [${stackName}]: ${err.message}`)
    }
    consoleLog('  Done.')
}

async function deleteEks(awsConfig, clusterName: string) {
    const eks = new aws.EKS({ ...awsConfig, apiVersion: '2017-11-01' })
    consoleLog(`Deleting EKS cluster "${clusterName}":`)
    try {
        await eks.deleteCluster({ name: clusterName }).promise()
    } catch (err) {
        if (err.code === 'ResourceNotFoundException') {
            consoleLog('  Already deleted - OK.')
            return
        }
        throw err
    }
    consoleLog('  Deleting...')
    await awaitAsyncCondition(
        async () => {
            const resp = await eks
                .describeCluster({ name: clusterName })
                .promise()
                .catch(() => null)
            return !resp || resp.cluster.status !== 'DELETING'
        },
        10 * 1000,
        20 * 60 * 1000,
        'EKS cluster to be deleted'
    )
    try {
        const resp = await eks.describeCluster({ name: clusterName }).promise()
        throw new Error(`Failed to delete EKS cluster ${clusterName}: ${resp.cluster.status}`)
    } catch (err) {
        if (err.code !== 'ResourceNotFoundException') {
            throw err
        }
    }
    consoleLog('  Done.')
}

export async function deleteEksCluster(options: { region: string; clusterName: string }) {
    const awsConfig = new aws.Config({ region: options.region })
    await ensureNoLoadBalancer(awsConfig, options.clusterName)
    await deleteCfStack(awsConfig, `${options.clusterName}-worker-nodes`)
    await deleteEks(awsConfig, options.clusterName)
    await deleteCfStack(awsConfig, options.clusterName)
}
