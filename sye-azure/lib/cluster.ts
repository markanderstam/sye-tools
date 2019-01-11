import { readPackageFile, syeEnvironmentFile, consoleLog } from '../../lib/common'
import * as EasyTable from 'easy-table'
const debug = require('debug')('azure/cluster')

import { createBlobService, BlobService } from 'azure-storage'
import { storageAccountName, publicContainerName, privateContainerName } from '../common'
import { NetworkInterface, PublicIPAddress } from 'azure-arm-network/lib/models'
import { validateClusterId } from '../common'
import { AzureSession } from '../../lib/azure/azure-session'

const ROOT_LOCATION = 'westus'

export interface ClusterMachine {
    Region: string
    Name: string
    Roles: string
    PrivateIpAddress: string
    PublicIpAddress: string
    DataDiskName?: string
}

export async function createCluster(
    clusterId: string,
    syeEnvironment: string,
    authorizedKeys: string,
    subscriptionNameOrId?: string
) {
    validateClusterId(clusterId)
    const azureSession = await new AzureSession().init({ subscriptionNameOrId })

    debug('Creating SYE cluster in Azure subscription', azureSession.currentSubscription.name)
    const resourceClient = azureSession.resourceManagementClient()
    await resourceClient.resourceGroups.createOrUpdate(clusterId, {
        location: ROOT_LOCATION,
        tags: {},
    })

    // Create Storage account with Blob storage
    const storageClient = azureSession.storageManagementClient()
    const createParameters = {
        location: ROOT_LOCATION,
        sku: {
            name: 'Standard_RAGRS',
        },
        kind: 'BlobStorage',
        accessTier: 'Hot',
        tags: {},
    }

    const storageAcctname = storageAccountName(azureSession.currentSubscription.id, clusterId)
    debug('Creating storage account', storageAcctname)
    await storageClient.storageAccounts.create(clusterId, storageAcctname, createParameters)

    debug('Listing keys in the storage account')
    let keys = await storageClient.storageAccounts.listKeys(clusterId, storageAcctname)

    debug('Create BLOB service', keys.keys[0].value)
    const blobService = createBlobService(storageAcctname, keys.keys[0].value)
    await createPublicContainerIfNotExistsPromise(blobService, publicContainerName())

    await createPrivateContainerIfNotExistsPromise(blobService, privateContainerName())

    // Upload files to blob storage
    await createBlockBlobFromTextPromise(
        blobService,
        publicContainerName(),
        'bootstrap.sh',
        readPackageFile('sye-azure/bootstrap.sh').toString()
    )

    await createBlockBlobFromTextPromise(
        blobService,
        publicContainerName(),
        'sye-cluster-join.sh',
        readPackageFile('sye-cluster-join.sh').toString()
    )

    await createBlockBlobFromLocalFilePromise(blobService, publicContainerName(), 'authorized_keys', authorizedKeys)

    await createBlockBlobFromLocalFilePromise(blobService, privateContainerName(), syeEnvironmentFile, syeEnvironment)
}

export async function uploadConfig(clusterId: string, syeEnvironment: string): Promise<void> {
    validateClusterId(clusterId)
    const azureSession = await new AzureSession().init({ resourceGroup: clusterId })

    const storageAcctname = storageAccountName(azureSession.currentSubscription.id, clusterId)
    let keys = await azureSession.storageManagementClient().storageAccounts.listKeys(clusterId, storageAcctname)
    const blobService = createBlobService(storageAcctname, keys.keys[0].value)
    await createBlockBlobFromLocalFilePromise(blobService, privateContainerName(), syeEnvironmentFile, syeEnvironment)
}

export async function deleteCluster(clusterId: string) {
    validateClusterId(clusterId)
    const azureSession = await new AzureSession().init({ resourceGroup: clusterId })

    await azureSession.resourceManagementClient().resourceGroups.deleteMethod(clusterId)
}

export async function showResources(clusterId: string, output = true, raw = false): Promise<ClusterMachine[]> {
    const tableData = new Array<ClusterMachine>()

    validateClusterId(clusterId)
    const azureSession = await new AzureSession().init({ resourceGroup: clusterId })
    if (azureSession.currentSubscription === null) {
        if (output) {
            if (raw) {
                consoleLog(JSON.stringify(tableData, null, 2))
            } else {
                consoleLog('')
            }
        }
        return tableData
    }

    const resourceClient = azureSession.resourceManagementClient()

    const resourceGroup = await resourceClient.resourceGroups.get(clusterId)

    // Find all the NICs in the resource group
    const networkClient = azureSession.networkManagementClient()
    const nicMap: { [id: string]: NetworkInterface } = {}
    for (const nic of await networkClient.networkInterfaces.list(clusterId)) {
        nicMap[nic.id] = nic
    }

    // Find all the Public IPs in the resource group
    const publicIpMap: { [id: string]: PublicIPAddress } = {}
    for (const publicIp of await networkClient.publicIPAddresses.list(clusterId)) {
        publicIpMap[publicIp.id] = publicIp
    }

    // Show all the VMs in the resource group
    const computeClient = azureSession.computeManagementClient()
    for (const vm of await computeClient.virtualMachines.list(clusterId)) {
        if (vm.networkProfile && vm.networkProfile.networkInterfaces) {
            for (const nic of vm.networkProfile!.networkInterfaces!) {
                const enrichedNic = nicMap[nic.id]
                const publicIp = publicIpMap[enrichedNic.ipConfigurations[0].publicIPAddress.id]
                tableData.push({
                    Region: vm.location,
                    Name: vm.name,
                    Roles: Object.keys(vm.tags).join(','),
                    PrivateIpAddress: enrichedNic.ipConfigurations[0].privateIPAddress,
                    PublicIpAddress: publicIp.ipAddress,
                    DataDiskName: (vm.storageProfile.dataDisks[0] || { name: undefined }).name,
                })
            }
        }
    }

    if (output) {
        if (raw) {
            consoleLog(JSON.stringify(tableData, null, 2))
        } else {
            consoleLog('')
            consoleLog(`Cluster '${clusterId}'`)
            consoleLog(
                `  Subscription: '${azureSession.currentSubscription.name}' (${azureSession.currentSubscription.id})`
            )
            consoleLog(`  Resource group: '${resourceGroup.name}'`)
            consoleLog(`  Location: '${resourceGroup.location}'`)
            consoleLog('')
            consoleLog(EasyTable.print(tableData))
        }
    }

    return tableData
}

export async function uploadBootstrap(clusterId: string): Promise<void> {
    validateClusterId(clusterId)
    const azureSession = await new AzureSession().init({ resourceGroup: clusterId })
    const storageAcctname = storageAccountName(azureSession.currentSubscription.id, clusterId)
    let storageClient = azureSession.storageManagementClient()
    let keys = await storageClient.storageAccounts.listKeys(clusterId, storageAcctname)
    const blobService = createBlobService(storageAcctname, keys.keys[0].value)
    await createBlockBlobFromTextPromise(
        blobService,
        publicContainerName(),
        'bootstrap.sh',
        readPackageFile('sye-azure/bootstrap.sh').toString()
    )
}

export async function uploadClusterJoin(clusterId: string): Promise<void> {
    validateClusterId(clusterId)
    const azureSession = await new AzureSession().init({ resourceGroup: clusterId })
    const storageAcctname = storageAccountName(azureSession.currentSubscription.id, clusterId)
    let storageClient = azureSession.storageManagementClient()
    let keys = await storageClient.storageAccounts.listKeys(clusterId, storageAcctname)
    const blobService = createBlobService(storageAcctname, keys.keys[0].value)
    await createBlockBlobFromTextPromise(
        blobService,
        publicContainerName(),
        'sye-cluster-join.sh',
        readPackageFile('sye-cluster-join.sh').toString()
    )
}

function createBlockBlobFromTextPromise(
    blobService: BlobService,
    container: string,
    blob: string,
    content: string
): Promise<BlobService.BlobResult> {
    debug('createBlockBlobFromTextPromise', container, blob)
    return new Promise((resolve, reject) => {
        blobService.createBlockBlobFromText(container, blob, content, (error, result) => {
            return error ? reject(error) : resolve(result)
        })
    })
}
function createBlockBlobFromLocalFilePromise(
    blobService: BlobService,
    container: string,
    blob: string,
    filename: string
): Promise<BlobService.BlobResult> {
    debug('createBlockBlobFromLocalFilePromise', container, blob)
    return new Promise((resolve, reject) => {
        blobService.createBlockBlobFromLocalFile(container, blob, filename, (error, result) => {
            return error ? reject(error) : resolve(result)
        })
    })
}

function createPrivateContainerIfNotExistsPromise(
    blobService: BlobService,
    container: string
): Promise<BlobService.ContainerResult> {
    return new Promise((resolve, reject) => {
        blobService.createContainerIfNotExists(container, (error, result) => {
            return error ? reject(error) : resolve(result)
        })
    })
}

function createPublicContainerIfNotExistsPromise(
    blobService: BlobService,
    container: string
): Promise<BlobService.ContainerResult> {
    debug('Create public container', container)
    return new Promise((resolve, reject) => {
        blobService.createContainerIfNotExists(container, { publicAccessLevel: 'blob' }, (error, result) => {
            return error ? reject(error) : resolve(result)
        })
    })
}
