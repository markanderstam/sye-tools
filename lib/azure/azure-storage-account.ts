import {
    Aborter,
    ServiceURL,
    SharedKeyCredential,
    StorageURL,
    Models,
    ContainerURL,
    uploadStreamToBlockBlob,
    BlockBlobURL,
    BlobURL,
    generateAccountSASQueryParameters,
    uploadFileToBlockBlob,
} from '@azure/storage-blob'
import { StorageAccount } from '@azure/arm-storage/esm/models'
import { AzureSession } from './azure-session'
import { Readable } from 'stream'

const debug = require('debug')('azure-storage')

/**
 * Convenience class providing access to Azure BLOB storage
 */
export class AzureStorageAccount {
    private account: StorageAccount | undefined
    private key: string | undefined
    private serviceUrl: ServiceURL | undefined
    private blobContainerURLs: { [name: string]: ContainerURL } = {}

    constructor(
        private readonly session: AzureSession,
        private readonly resourceGroupName: string,
        private readonly location: string,
        private readonly storageAccountName: string
    ) {}

    async listStorageAccounts(): Promise<string[]> {
        const response = await this.session.storageManagementClient().storageAccounts.list()
        return response.map((e) => e.name)
    }

    async exists() {
        return (await this.listStorageAccounts()).find((n) => n === this.storageAccountName)
    }

    async create(): Promise<void> {
        if (this.account) {
            return
        }

        debug('Check if the storage account exists', { storageAccountName: this.storageAccountName })
        if (await this.exists()) {
            return
        }
        debug('Make sure the account name is available', { storageAccountName: this.storageAccountName })
        if (
            !(await this.session
                .storageManagementClient()
                .storageAccounts.checkNameAvailability(this.storageAccountName))
        ) {
            throw new Error(`The storage account name is not available: name=${this.storageAccountName}`)
        }

        debug('Creating the storage account')
        this.account = await this.session
            .storageManagementClient()
            .storageAccounts.create(this.resourceGroupName, this.storageAccountName, {
                location: this.location,
                sku: {
                    name: 'Standard_RAGRS',
                },
                kind: 'BlobStorage',
                accessTier: 'Hot',
                tags: {},
            })
        debug('account', { account: this.account })
    }

    private async getStorageAccountKey(): Promise<string> {
        if (!this.key) {
            const keyList = await this.session
                .storageManagementClient()
                .storageAccounts.listKeys(this.resourceGroupName, this.storageAccountName)
            //return `DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${keyList.keys![0].value};EndpointSuffix=core.windows.net`
            this.key = keyList.keys![0].value!
        }
        return this.key
    }

    private async getServiceURL() {
        if (!this.serviceUrl) {
            const sharedKeyCredential = new SharedKeyCredential(
                this.storageAccountName,
                await this.getStorageAccountKey()
            )
            const pipeline = StorageURL.newPipeline(sharedKeyCredential, {
                retryOptions: { maxTries: 4 },
            })

            this.serviceUrl = new ServiceURL(`https://${this.storageAccountName}.blob.core.windows.net`, pipeline)
        }
        return this.serviceUrl
    }

    private async checkIfBlobContainerExists(storageAccountUrl: ServiceURL, name: string): Promise<boolean> {
        let marker
        do {
            const listContainersResponse: Models.ServiceListContainersSegmentResponse = await storageAccountUrl.listContainersSegment(
                Aborter.none,
                marker
            )

            marker = listContainersResponse.nextMarker
            for (const container of listContainersResponse.containerItems) {
                debug('Checking container', { name: container.name })
                if (container.name === name) {
                    debug('Found the container', { container })
                    return true
                }
            }
        } while (marker)
        return false
    }

    async createBlobContainer(containerName: string, publicAccess: boolean): Promise<ContainerURL> {
        if (!this.blobContainerURLs[containerName]) {
            const containerURL = ContainerURL.fromServiceURL(await this.getServiceURL(), containerName)
            if (await this.checkIfBlobContainerExists(await this.getServiceURL(), containerName)) {
                debug('Blob container akready exists', { containerName })
                return containerURL
            }

            await containerURL.create(Aborter.none, {
                access: publicAccess ? 'blob' : undefined,
            })
            this.blobContainerURLs[containerName] = containerURL
        }
        return this.blobContainerURLs[containerName]
    }

    async uploadBlobText(containerName: string, blobName: string, publicAccess: boolean, text: string): Promise<void> {
        const containerURL = await this.createBlobContainer(containerName, publicAccess)
        const blobURL = BlobURL.fromContainerURL(containerURL, blobName)
        const blockBlobURL = BlockBlobURL.fromBlobURL(blobURL)

        const stream = new Readable()
        stream.push(text)
        stream.push(null)

        await uploadStreamToBlockBlob(Aborter.timeout(60 * 1000), stream, blockBlobURL, 4 * 1024 * 1024, 20)
    }

    async uploadBlobFile(
        containerName: string,
        blobName: string,
        publicAccess: boolean,
        localPath: string
    ): Promise<void> {
        const containerURL = await this.createBlobContainer(containerName, publicAccess)
        const blobURL = BlobURL.fromContainerURL(containerURL, blobName)
        const blockBlobURL = BlockBlobURL.fromBlobURL(blobURL)

        await uploadFileToBlockBlob(Aborter.timeout(60 * 1000), localPath, blockBlobURL)
    }

    private async getSharedKeyCredential(): Promise<SharedKeyCredential> {
        return new SharedKeyCredential(this.storageAccountName, await this.getStorageAccountKey())
    }

    async getTemporaryAccessUrl(containerName: string, blobName: string): Promise<string> {
        const startTime = new Date()
        startTime.setMinutes(startTime.getMinutes() - 5)

        const expiryTime = new Date()
        expiryTime.setMinutes(expiryTime.getMinutes() + 10)

        let SAS = generateAccountSASQueryParameters(
            {
                expiryTime: expiryTime,
                //            ipRange: { start: "0.0.0.0", end: "255.255.255.255" },
                permissions: 'r',
                resourceTypes: 'o',
                services: 'bf',
                startTime: startTime,
                version: '2016-05-31',
            },
            await this.getSharedKeyCredential()
        )

        return `https://${this.storageAccountName}.blob.core.windows.net/${containerName}/${blobName}?${SAS.toString()}`
    }

    getPublicUrl(containerName: string, blobName: string = null): string {
        const baseUrl = `https://${this.storageAccountName}.blob.core.windows.net/${containerName}`
        return blobName ? `${baseUrl}/${blobName}` : baseUrl
    }
}
