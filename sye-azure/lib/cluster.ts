import { readPackageFile } from '../../lib/common'
import { ResourceManagementClient } from 'azure-arm-resource'
import StorageManagementClient = require('azure-arm-storage')

import { createBlobService, BlobService } from 'azure-storage'
import {
    validateClusterId,
    getCredentials,
    storageAccountName,
    publicContainerName,
    privateContainerName,
} from './common'

const SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID
const ROOT_LOCATION = 'westus'

export async function createCluster(clusterId: string, syeEnvironment: string, authorizedKeys: string) {
    validateClusterId(clusterId)
    // Create Resource Group
    let credentials = await getCredentials(clusterId)

    let resourceClient = new ResourceManagementClient(credentials, SUBSCRIPTION_ID)
    await resourceClient.resourceGroups.createOrUpdate(clusterId, {
        location: ROOT_LOCATION,
        tags: {},
    })

    // Create Storage account with Blob storage
    let storageClient = new StorageManagementClient(credentials, SUBSCRIPTION_ID)
    let createParameters = {
        location: ROOT_LOCATION,
        sku: {
            name: 'Standard_RAGRS',
        },
        kind: 'BlobStorage',
        accessTier: 'Hot',
        tags: {},
    }

    await storageClient.storageAccounts.create(clusterId, storageAccountName(clusterId), createParameters)

    let keys = await storageClient.storageAccounts.listKeys(clusterId, clusterId)

    const blobService = createBlobService(storageAccountName(clusterId), keys.keys[0].value)
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

export async function deleteCluster(_clusterId: string) {}

function createBlockBlobFromTextPromise(
    blobService: BlobService,
    container: string,
    blob: string,
    content: string
): Promise<BlobService.BlobResult> {
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
    return new Promise((resolve, reject) => {
        blobService.createContainerIfNotExists(container, { publicAccessLevel: 'blob' }, (error, result) => {
            return error ? reject(error) : resolve(result)
        })
    })
}
