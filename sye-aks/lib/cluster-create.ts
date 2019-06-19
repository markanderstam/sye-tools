import { consoleLog } from '../../lib/common'
import * as util from 'util'
import * as fs from 'fs'
import {
    installTillerRbac,
    installTiller,
    waitForTillerStarted,
    installNginxIngress,
    installPrometheus,
    installPrometheusOperator,
    installPrometheusAdapter,
} from '../../lib/k8s'
import { AzureSession } from '../../lib/azure/azure-session'
import { promisify } from 'util'
import { getK8sResourceGroup } from './aks-config'
import { getVnetName } from './aks-config'
import { getSubnetName } from './aks-config'
import { getAksServicePrincipalName } from './aks-config'
import { ServicePrincipal } from '@azure/graph/lib/models'
import { ContainerServiceVMSizeTypes } from '@azure/arm-containerservice/src/models/index'

const debug = require('debug')('aks/cluster-create')

async function addCredentials(
    azureSession: AzureSession,
    servicePrincipal: ServicePrincipal,
    k8sResourceGroup: string,
    resourceGroup: string,
    vnetName: string,
    subnetName: string
) {
    await azureSession.assignRoleToServicePrincipal(
        servicePrincipal,
        azureSession.getResourceGroupScope(k8sResourceGroup),
        azureSession.getRoleDefinitionId(azureSession.CONTRIBUTOR_ROLE_NAME)
    )
    await azureSession.assignRoleToServicePrincipal(
        servicePrincipal,
        azureSession.getSubnetScope(resourceGroup, vnetName, subnetName),
        azureSession.getRoleDefinitionId(azureSession.NETWORK_CONTRIBUTOR_ROLE_NAME)
    )
}

async function downloadKubectlCredentials(
    azureSession: AzureSession,
    kubeconfig: string,
    resourceGroup: string,
    clusterName: string
) {
    consoleLog(`Download kubectl credentials to ${kubeconfig}.`)
    if (fs.existsSync(kubeconfig)) {
        consoleLog('  Deleting old file...')
        await util.promisify(fs.unlink)(kubeconfig)
    }
    consoleLog('  Downloading new file from Azure AKS...')
    const containerServiceClient = azureSession.containerServiceClient()
    const adminCredentials = await containerServiceClient.managedClusters.listClusterAdminCredentials(
        resourceGroup,
        clusterName
    )
    debug('Found credentials', adminCredentials)
    await promisify(fs.writeFile)(kubeconfig, adminCredentials.kubeconfigs[0].value)
    consoleLog('  Done.')
}

export async function createAksCluster(options: {
    subscription?: string
    resourceGroup: string
    location: string
    name: string
    release: string
    nodePoolName: string
    count: number
    vmSize: ContainerServiceVMSizeTypes
    enableAutoScaling: boolean
    minCount: number
    maxCount: number
    password: string
    kubeconfig: string
    cidr: string
    maxPods?: number
    openSshPort?: boolean
    publicKeyPath?: string
    installPrometheus: boolean
}) {
    const azureSession = await new AzureSession().init({
        subscriptionNameOrId: options.subscription,
    })
    const k8sResourceGroup = await getK8sResourceGroup(options.resourceGroup, options.name, options.location)
    await azureSession.createSubnet(
        options.resourceGroup,
        getVnetName(options.resourceGroup),
        getSubnetName(options.name),
        options.cidr
    )
    const servicePrincipalName = getAksServicePrincipalName(options.resourceGroup)
    const params = {
        ...options,
        servicePrincipalName,
        vnetName: getVnetName(options.resourceGroup),
        subnetName: getSubnetName(options.name),
    }
    await azureSession.createCluster(params)

    const servicePrincipal = await azureSession.getServicePrincipal(servicePrincipalName)
    await addCredentials(
        azureSession,
        servicePrincipal,
        k8sResourceGroup,
        options.resourceGroup,
        getVnetName(options.resourceGroup),
        getSubnetName(options.name)
    )
    await azureSession.enableVmssPublicIps(k8sResourceGroup, options.publicKeyPath)
    await azureSession.openPortInNsg(2123, 2130, 'Udp', 200, 'Sye SSP traffic (UDP 2123-2130)', k8sResourceGroup)
    await azureSession.openPortInNsg(2505, 2505, 'Tcp', 202, 'Connect Broker traffic (TCP 2505)', k8sResourceGroup)
    if (options.openSshPort) {
        await azureSession.openPortInNsg(22, 22, 'Tcp', 201, 'SSH access', k8sResourceGroup)
    }
    await downloadKubectlCredentials(azureSession, options.kubeconfig, options.resourceGroup, options.name)
    installTillerRbac(options.kubeconfig)
    installTiller(options.kubeconfig)
    waitForTillerStarted(options.kubeconfig)
    installNginxIngress(options.kubeconfig)
    if (installPrometheus) {
        installPrometheusOperator(options.kubeconfig)
        installPrometheus(options.kubeconfig)
        installPrometheusAdapter(options.kubeconfig)
    }
}
