import * as aws from 'aws-sdk'
import { execSync, readPackageFile, consoleLog, awaitAsyncCondition } from '../../lib/common'
import {
    installTillerRbac,
    installTiller,
    waitForTillerStarted,
    installNginxIngress,
    installMetricsServer,
    installPrometheus,
    installClusterAutoscaler,
    installPrometheusOperator,
    installPrometheusAdapter,
} from '../../lib/k8s'
import { saveKubeconfigToFile } from './utils'

const VPC_TEMPLATE_URL =
    'https://amazon-eks.s3-us-west-2.amazonaws.com/cloudformation/2018-08-30/amazon-eks-vpc-sample.yaml'

export interface Context {
    awsConfig: aws.Config
    vpcStackName: string
    clusterName: string
    kubernetesVersion: string
    kubeconfig: string
    clusterRole: string
    workersStackName: string
    workersNodeGroupName: string
    workersMinSize: number
    workersMaxSize: number
    workerInstanceType: string
    workerAmi: string
    workerSshKey: string
}

async function createVpc(ctx: Context) {
    consoleLog(`EKS VPC ${ctx.vpcStackName}:`)
    const cloudformation = new aws.CloudFormation({ ...ctx.awsConfig, apiVersion: '2010-05-15' })
    try {
        await cloudformation
            .createStack({
                StackName: ctx.vpcStackName,
                TemplateURL: VPC_TEMPLATE_URL,
            })
            .promise()
    } catch (err) {
        if (err.code === 'AlreadyExistsException') {
            consoleLog('  Already exists - OK.')
            return
        }
        throw err
    }
    consoleLog('  Creating...')
    try {
        await cloudformation.waitFor('stackCreateComplete', { StackName: ctx.vpcStackName }).promise()
    } catch (err) {
        throw new Error(`Failed to create EKS VPC stack [${ctx.vpcStackName}]: ${err.message}`)
    }
    consoleLog('  Done.')
}

async function createCluster(ctx: Context) {
    const eks = new aws.EKS({ ...ctx.awsConfig, apiVersion: '2017-11-01' })
    const roleArn = await getRoleArn(ctx)
    const securityGroupIds = await getSecurityGroups(ctx)
    const subnetIds = await getSubnetIds(ctx)
    consoleLog(`EKS cluster ${ctx.clusterName}:`)
    try {
        await eks
            .createCluster({
                name: ctx.clusterName,
                version: ctx.kubernetesVersion,
                roleArn: roleArn,
                resourcesVpcConfig: { subnetIds, securityGroupIds },
            })
            .promise()
    } catch (err) {
        if (err.code === 'ResourceInUseException') {
            consoleLog('  Already exists - OK.')
            return
        }
        throw err
    }
    consoleLog('  Creating...')
    await awaitAsyncCondition(
        async () => {
            const resp = await eks.describeCluster({ name: ctx.clusterName }).promise()
            return resp.cluster.status !== 'CREATING'
        },
        10 * 1000,
        20 * 60 * 1000,
        'EKS cluster to be available'
    )
    const resp = await eks.describeCluster({ name: ctx.clusterName }).promise()
    if (resp.cluster.status !== 'ACTIVE') {
        throw new Error(`Failed to create EKS cluster ${ctx.clusterName}: ${resp.cluster.status}`)
    }
    consoleLog('  Done.')
}

async function createWorkers(ctx: Context) {
    const cloudformation = new aws.CloudFormation({ ...ctx.awsConfig, apiVersion: '2010-05-15' })
    const templateBody = readPackageFile('sye-eks/amazon-eks-nodegroup.yaml').toString()
    const vpcId = await getVpcId(ctx)
    const securityGroups = await getSecurityGroups(ctx)
    const subnetIds = await getSubnetIds(ctx)
    consoleLog(`Worker nodes ${ctx.workersStackName}:`)
    try {
        await cloudformation
            .createStack(
                {
                    StackName: ctx.workersStackName,
                    TemplateBody: templateBody,
                    Parameters: [
                        { ParameterKey: 'ClusterName', ParameterValue: ctx.clusterName },
                        { ParameterKey: 'ClusterControlPlaneSecurityGroup', ParameterValue: securityGroups.join(',') },
                        { ParameterKey: 'NodeGroupName', ParameterValue: ctx.workersNodeGroupName },
                        { ParameterKey: 'NodeAutoScalingGroupMinSize', ParameterValue: ctx.workersMinSize.toString() },
                        { ParameterKey: 'NodeAutoScalingGroupMaxSize', ParameterValue: ctx.workersMaxSize.toString() },
                        { ParameterKey: 'NodeInstanceType', ParameterValue: ctx.workerInstanceType },
                        { ParameterKey: 'NodeImageId', ParameterValue: ctx.workerAmi },
                        { ParameterKey: 'KeyName', ParameterValue: ctx.workerSshKey },
                        { ParameterKey: 'VpcId', ParameterValue: vpcId },
                        { ParameterKey: 'Subnets', ParameterValue: subnetIds.join(',') },
                    ],
                    Capabilities: ['CAPABILITY_IAM'],
                    Tags: [{ Key: 'k8s.io/cluster-autoscaler/enabled', Value: 'true' }],
                },
                undefined
            )
            .promise()
    } catch (err) {
        if (err.code === 'AlreadyExistsException') {
            consoleLog('  Already exists - OK.')
            return
        }
        throw err
    }
    consoleLog('  Creating...')
    try {
        await cloudformation.waitFor('stackCreateComplete', { StackName: ctx.workersStackName }).promise()
    } catch (err) {
        throw new Error(`Failed to create worker nodes stack [${ctx.workersStackName}]: ${err.message}`)
    }
    consoleLog('  Done.')
}

async function createKubeconfig(ctx: Context) {
    consoleLog(`Creating kubeconfig ${ctx.kubeconfig}:`)
    await saveKubeconfigToFile(ctx.awsConfig, ctx.clusterName, ctx.kubeconfig)
    consoleLog('  Done.')
}

async function enableWorkers(ctx: Context) {
    const roleArn = await getNodeInstanceRole(ctx)
    const specFile = `apiVersion: v1
kind: ConfigMap
metadata:
    name: aws-auth
    namespace: kube-system
data:
  mapRoles: |
    - rolearn: ${roleArn}
      username: system:node:{{EC2PrivateDNSName}}
      groups:
        - system:bootstrappers
        - system:nodes`
    consoleLog(`Authorizing workers to join cluster:`)
    try {
        execSync(`kubectl apply --kubeconfig ${ctx.kubeconfig} -f -`, { input: specFile })
    } catch (err) {
        throw new Error(`Failed to authorize workers: ${err.message}`)
    }
    consoleLog('  Done.')
}

async function setupStorage(ctx: Context) {
    const specFile = `---
kind: StorageClass
apiVersion: storage.k8s.io/v1
metadata:
    name: gp2
    annotations:
        storageclass.kubernetes.io/is-default-class: "true"
provisioner: kubernetes.io/aws-ebs
parameters:
    type: gp2
reclaimPolicy: Delete
mountOptions:
    - debug`
    consoleLog(`Setting up storage class:`)
    try {
        execSync(`kubectl apply --kubeconfig ${ctx.kubeconfig} -f -`, {
            input: specFile,
        })
    } catch (err) {
        throw new Error(`Failed to create storage class: ${err.message}`)
    }
    consoleLog('  Done.')
}

async function getVpcId(ctx: Context): Promise<string> {
    return getStackOutput(ctx.awsConfig, ctx.vpcStackName, 'VpcId')
}

async function getSecurityGroups(ctx: Context): Promise<string[]> {
    return getStackOutput(ctx.awsConfig, ctx.vpcStackName, 'SecurityGroups').then((out) => out.split(','))
}

function getSubnetIds(ctx: Context): Promise<string[]> {
    return getStackOutput(ctx.awsConfig, ctx.vpcStackName, 'SubnetIds').then((out) => out.split(','))
}

function getNodeInstanceRole(ctx: Context): Promise<string> {
    return getStackOutput(ctx.awsConfig, ctx.workersStackName, 'NodeInstanceRole')
}

async function getStackOutput(awsConfig: aws.Config, stackName: string, outputKey: string): Promise<string> {
    const cloudformation = new aws.CloudFormation({ ...awsConfig, apiVersion: '2010-05-15' })
    const response = await cloudformation.describeStacks({ StackName: stackName }).promise()
    return response.Stacks[0].Outputs.find((output) => output.OutputKey === outputKey).OutputValue
}

async function getRoleArn(ctx: Context): Promise<string> {
    const iam = new aws.IAM({ ...ctx.awsConfig, apiVersion: '2010-05-08' })
    const role = (await iam.getRole({ RoleName: ctx.clusterRole }).promise()).Role
    return role.Arn
}

export async function createEksCluster(options: {
    clusterRole: string
    region: string
    clusterName: string
    kubeconfig: string
    kubernetesVersion: string
    instanceType: string
    workerAmi: string
    nodeCount: number
    minNodeCount: number
    nodeSshKey: string
}) {
    const ctx: Context = {
        awsConfig: new aws.Config({ region: options.region }),
        clusterName: options.clusterName,
        vpcStackName: options.clusterName,
        kubernetesVersion: options.kubernetesVersion,
        kubeconfig: options.kubeconfig,
        clusterRole: options.clusterRole,
        workersStackName: `${options.clusterName}-worker-nodes`,
        workersNodeGroupName: `${options.clusterName}-node_group`,
        workersMinSize: options.minNodeCount,
        workersMaxSize: options.nodeCount,
        workerInstanceType: options.instanceType,
        workerAmi: options.workerAmi,
        workerSshKey: options.nodeSshKey,
    }
    await createVpc(ctx)
    await createCluster(ctx)
    await createWorkers(ctx)
    await createKubeconfig(ctx)
    await enableWorkers(ctx)
    await setupStorage(ctx)
    installTillerRbac(ctx.kubeconfig)
    installTiller(ctx.kubeconfig)
    waitForTillerStarted(ctx.kubeconfig)
    installNginxIngress(ctx.kubeconfig)
    installMetricsServer(ctx.kubeconfig)
    installPrometheusOperator(ctx.kubeconfig)
    installPrometheus(ctx.kubeconfig)
    installPrometheusAdapter(ctx.kubeconfig)
    installClusterAutoscaler(ctx.kubeconfig, 'aws', [
        `--set image.tag=v1.2.2`,
        `--set autoDiscovery.clusterName=${options.clusterName}`,
        `--set awsRegion=${options.region}`,
        '--set sslCertPath=/etc/kubernetes/pki/ca.crt',
    ])
}
