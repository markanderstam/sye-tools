import { readPackageFile, syeEnvironmentFile, consoleLog } from '../../lib/common'
import * as EasyTable from 'easy-table'
import { storageAccountName, publicContainerName, privateContainerName } from '../common'
import { NetworkInterface, PublicIPAddress } from '@azure/arm-network/esm/models'
import { validateClusterId } from '../common'
import { AzureSession } from '../../lib/azure/azure-session'
import { AzureStorageAccount } from '../../lib/azure/azure-storage-account'
import * as fs from 'fs'

const debug = require('debug')('azure/cluster')

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

    const storageAcctname = storageAccountName(azureSession.currentSubscription.id, clusterId)
    const storageAccount = new AzureStorageAccount(azureSession, clusterId, ROOT_LOCATION, storageAcctname)
    debug('Creating storage account', storageAcctname)
    await storageAccount.create()

    // Upload files to blob storage
    await storageAccount.uploadBlobText(
        publicContainerName(),
        'bootstrap.sh',
        true,
        readPackageFile('sye-azure/bootstrap.sh').toString()
    )
    await storageAccount.uploadBlobText(
        publicContainerName(),
        'sye-cluster-join.sh',
        true,
        readPackageFile('sye-cluster-join.sh').toString()
    )
    await storageAccount.uploadBlobText(
        publicContainerName(),
        'authorized_keys',
        true,
        fs.readFileSync(authorizedKeys).toString()
    )
    await storageAccount.uploadBlobFile(privateContainerName(), syeEnvironmentFile, false, syeEnvironment)
}

export async function uploadConfig(clusterId: string, syeEnvironment: string): Promise<void> {
    validateClusterId(clusterId)
    const azureSession = await new AzureSession().init({ resourceGroup: clusterId })
    const storageAcctname = storageAccountName(azureSession.currentSubscription.id, clusterId)
    const storageAccount = new AzureStorageAccount(azureSession, clusterId, ROOT_LOCATION, storageAcctname)

    await storageAccount.uploadBlobText(privateContainerName(), syeEnvironmentFile, false, syeEnvironment)
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
    const storageAccount = new AzureStorageAccount(azureSession, clusterId, ROOT_LOCATION, storageAcctname)
    await storageAccount.uploadBlobText(
        publicContainerName(),
        'bootstrap.sh',
        true,
        readPackageFile('sye-azure/bootstrap.sh').toString()
    )
}

export async function uploadClusterJoin(clusterId: string): Promise<void> {
    validateClusterId(clusterId)
    const azureSession = await new AzureSession().init({ resourceGroup: clusterId })
    const storageAcctname = storageAccountName(azureSession.currentSubscription.id, clusterId)
    const storageAccount = new AzureStorageAccount(azureSession, clusterId, ROOT_LOCATION, storageAcctname)
    await storageAccount.uploadBlobText(
        publicContainerName(),
        'sye-cluster-join.sh',
        true,
        readPackageFile('sye-cluster-join.sh').toString()
    )
}
