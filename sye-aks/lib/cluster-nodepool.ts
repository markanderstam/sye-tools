import { AzureSession } from '../../lib/azure/azure-session'
import { consoleLog } from '../../lib/common'
import { ContainerServiceVMSizeTypes } from '@azure/arm-containerservice/esm/models'

export async function addNodePoolToAksCluster(options: {
    subscription?: string
    resourceGroup: string
    name: string
    nodePoolName: string
    size: number
    vmSize: string
    enableAutoScaling: boolean
    minCount: number
    maxCount: number
}) {
    consoleLog('Adding nodepool to AKS VMSS cluster:')
    const azureSession = await new AzureSession().init({ subscriptionNameOrId: options.subscription })
    consoleLog('  Finding cluster...')
    const aksCluster = await azureSession.getAksCluster({
        clusterName: options.name,
        resourceGroup: options.resourceGroup,
    })
    consoleLog('  Validating...')
    if (!aksCluster.agentPoolProfiles.find((ap) => ap.type === 'VirtualMachineScaleSets')) {
        throw new Error('The cluster is not a VMSS base AKS cluster')
    }

    if (aksCluster.agentPoolProfiles.find((ap) => ap.name === options.nodePoolName)) {
        consoleLog(`  The nodepool '${options.nodePoolName}' already exists - updating it.`)
    } else {
        consoleLog('  Adding nodepool...')
    }

    await azureSession
        .containerServiceClient()
        .agentPools.createOrUpdate(options.resourceGroup, options.name, options.nodePoolName, {
            agentPoolType: 'VirtualMachineScaleSets',
            count: options.size,
            vmSize: options.vmSize as ContainerServiceVMSizeTypes,
            //vnetSubnetID: subnet.id,
            minCount: options.minCount > 0 ? options.minCount : undefined,
            maxCount: options.minCount > 0 ? options.maxCount : undefined,
            osType: 'Linux',
            enableAutoScaling: options.minCount > 0,
        })
    consoleLog('  Adding public IPs to VMs...')
    await azureSession.enableVmssPublicIps(aksCluster.nodeResourceGroup)
    consoleLog('  Nodepool was added.')
}

export async function deleteNodePoolToAksCluster(
    subscription: string | undefined,
    options: {
        subscription?: string
        resourceGroup: string
        name: string
        nodePoolName: string
    }
) {
    consoleLog('Delete nodepool from AKS VMSS cluster:')
    const azureSession = await new AzureSession().init({ subscriptionNameOrId: subscription })
    consoleLog('  Finding cluster...')
    const aksCluster = await azureSession.getAksCluster({
        clusterName: options.name,
        resourceGroup: options.resourceGroup,
    })
    consoleLog('  Validating...')
    if (!aksCluster.agentPoolProfiles.find((ap) => ap.type === 'VirtualMachineScaleSets')) {
        throw new Error('The cluster is not a VMSS base AKS cluster')
    }

    if (!aksCluster.agentPoolProfiles.find((ap) => ap.name === options.nodePoolName)) {
        throw new Error(`The nodepool '${options.nodePoolName}' does not exist`)
    }

    consoleLog('  Deleting nodepool...')
    await azureSession
        .containerServiceClient()
        .agentPools.deleteMethod(options.resourceGroup, options.name, options.nodePoolName)
    consoleLog('  Nodepool was deleted.')
}
