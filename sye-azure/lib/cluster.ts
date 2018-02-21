import { readPackageFile } from '../../lib/common'
import { ResourceManagementClient } from 'azure-arm-resource'
import StorageManagementClient = require('azure-arm-storage')
import ComputeClient = require('azure-arm-compute')
import NetworkClient = require('azure-arm-network')
import * as EasyTable from 'easy-table'
const debug = require('debug')('azure/cluster')

import { createBlobService, BlobService } from 'azure-storage'
import {
    validateClusterId,
    getCredentials,
    getSubscription,
    storageAccountName,
    publicContainerName,
    privateContainerName,
} from './common'
import { NetworkInterface, PublicIPAddress } from 'azure-arm-network/lib/models'

const ROOT_LOCATION = 'westus'

export async function createCluster(
    clusterId: string,
    syeEnvironment: string,
    authorizedKeys: string,
    subscription: string | null
) {
    validateClusterId(clusterId)
    const credentials = await getCredentials(clusterId)
    const subscriptionId = (await getSubscription(credentials, { subscription: subscription })).subscriptionId

    debug('Creating SYE cluster in Azure subscription', subscriptionId)
    let resourceClient = new ResourceManagementClient(credentials, subscriptionId)
    await resourceClient.resourceGroups.createOrUpdate(clusterId, {
        location: ROOT_LOCATION,
        tags: {},
    })

    // Create Storage account with Blob storage
    let storageClient = new StorageManagementClient(credentials, subscriptionId)
    let createParameters = {
        location: ROOT_LOCATION,
        sku: {
            name: 'Standard_RAGRS',
        },
        kind: 'BlobStorage',
        accessTier: 'Hot',
        tags: {},
    }

    const storageAcctname = storageAccountName(subscriptionId, clusterId)
    debug('Creating storage account', storageAcctname)
    await storageClient.storageAccounts.create(clusterId, storageAcctname, createParameters)

    debug('Listing keys in the storage account')
    let keys = await storageClient.storageAccounts.listKeys(clusterId, storageAcctname)

    debug('Create BLOB service', keys.keys[0].value)
    const blobService = createBlobService(storageAcctname, keys.keys[0].value)
    await createPublicContainerIfNotExistsPromise(blobService, publicContainerName())

    // TODO: This container should definitely not be public!
    // Must figure out how to access it from the VMs
    await createPublicContainerIfNotExistsPromise(blobService, privateContainerName())

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

    await createBlockBlobFromLocalFilePromise(
        blobService,
        privateContainerName(),
        'sye-environment.tar.gz',
        syeEnvironment
    )
}

export async function deleteCluster(clusterId: string) {
    validateClusterId(clusterId)
    const credentials = await getCredentials(clusterId)
    const subscriptionId = (await getSubscription(credentials, { resourceGroup: clusterId })).subscriptionId

    const resourceClient = new ResourceManagementClient(credentials, subscriptionId)
    await resourceClient.resourceGroups.deleteMethod(clusterId)
}

export async function showResources(clusterId: string, _b: boolean, _rw: boolean): Promise<void> {
    validateClusterId(clusterId)
    const credentials = await getCredentials(clusterId)

    //const subscriptionClient = await subscriptionManagement.createSubscriptionClient(credentials)

    const subscription = await getSubscription(credentials, { resourceGroup: clusterId })

    const resourceClient = new ResourceManagementClient(credentials, subscription.subscriptionId)

    const resourceGroup = await resourceClient.resourceGroups.get(clusterId)
    console.log('')
    console.log(`Cluster '${clusterId}'`)
    console.log(`  Subscription: '${subscription.displayName}' (${subscription.subscriptionId})`)
    console.log(`  Resource group: '${resourceGroup.name}'`)
    console.log(`  Location: '${resourceGroup.location}'`)
    console.log('')

    // Find all the NICs in the resource group
    const networkClient = new NetworkClient(credentials, subscription.subscriptionId)
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
    const tableData: {
        Region: string
        Name: string
        PrivateIpAddress: string
        PublicIpAddress: string
    }[] = []
    const computeClient = new ComputeClient(credentials, subscription.subscriptionId)
    for (const vm of await computeClient.virtualMachines.list(clusterId)) {
        if (vm.networkProfile && vm.networkProfile.networkInterfaces) {
            for (const nic of vm.networkProfile!.networkInterfaces!) {
                const enrichedNic = nicMap[nic.id]
                const publicIp = publicIpMap[enrichedNic.ipConfigurations[0].publicIPAddress.id]
                tableData.push({
                    Region: vm.location,
                    Name: vm.name,
                    PrivateIpAddress: enrichedNic.ipConfigurations[0].privateIPAddress,
                    PublicIpAddress: publicIp.ipAddress,
                })
            }
        }
    }
    console.log(EasyTable.print(tableData))
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

// function createContainerIfNotExistsPromise(blobService: BlobService, container: string): Promise<BlobService.ContainerResult> {
//     return new Promise( (resolve, reject) => {
//         blobService.createContainerIfNotExists(container, (error, result) => {
//             return error ? reject(error) : resolve(result)
//         })
//     })
// }

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
