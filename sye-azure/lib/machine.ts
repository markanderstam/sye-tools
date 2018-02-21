import * as dbg from 'debug'
const debug = dbg('azure/machine')
import NetworkManagementClient = require('azure-arm-network')
import StorageManagementClient = require('azure-arm-storage')
import { createBlobService, BlobUtilities } from 'azure-storage'

import {
    validateClusterId,
    getCredentials,
    getSubscription,
    vmName,
    publicIpName,
    ipConfigName,
    nicName,
    vnetName,
    subnetName,
    publicContainerName,
    privateContainerName,
    dataDiskName,
    storageAccountName,
} from './common'
import ComputeClient = require('azure-arm-compute')
import { VirtualMachine } from 'azure-arm-compute/lib/models'
import { exit, syeEnvironmentFile } from '../../lib/common'

export async function machineAdd(
    clusterId: string,
    region: string,
    availabilityZone: string,
    machineName: string,
    instanceType: string,
    roles: string[],
    management: boolean,
    storage: number
) {
    let args = ''
    if (management) {
        args += ' --management eth0'
    }

    let hasStorage = !!storage

    validateClusterId(clusterId)

    let credentials = await getCredentials(clusterId)

    const subscription = await getSubscription(credentials, { resourceGroup: clusterId })

    const networkClient = new NetworkManagementClient(credentials, subscription.subscriptionId)
    const computeClient = new ComputeClient(credentials, subscription.subscriptionId)
    let subnetInfo = await networkClient.subnets.get(clusterId, vnetName(region), subnetName(region))

    // Check if machine exists before trying to create it
    try {
        let existingVm = await computeClient.virtualMachines.get(clusterId, vmName(machineName))
        debug('existingVm', existingVm)
        exit(`Machine ${machineName} already exists`)
    } catch (e) {
        if (e.code !== 'ResourceNotFound') throw e
    }

    let publicIPParameters = {
        location: region,
        publicIPAllocationMethod: 'Dynamic',
    }

    let publicIPInfo = await networkClient.publicIPAddresses.createOrUpdate(
        clusterId,
        publicIpName(machineName),
        publicIPParameters
    )

    debug('publicIPInfo', publicIPInfo)

    // Need to configure SR-IOV here!
    let nicParameters = {
        location: region,
        ipConfigurations: [
            {
                name: ipConfigName(machineName),
                privateIPAllocationMethod: 'Dynamic',
                subnet: subnetInfo,
                publicIPAddress: publicIPInfo,
            },
        ],
    }

    let networkInterface = await networkClient.networkInterfaces.createOrUpdate(
        clusterId,
        nicName(machineName),
        nicParameters
    )

    debug('networkInterface', networkInterface)

    // let imageInfo = await computeClient.virtualMachineImages.list(region, 'Canonical', 'UbuntuServer', '16.04-LTS', { top: 1 }) // Finds the OLDEST version
    // let version = imageInfo[0].name
    // debug('imageInfo', imageInfo)

    let storageAccount = storageAccountName(subscription.subscriptionId, clusterId)

    let storageClient = new StorageManagementClient(credentials, subscription.subscriptionId)
    let keys = await storageClient.storageAccounts.listKeys(clusterId, storageAccount)
    const blobService = createBlobService(storageAccount, keys.keys[0].value)

    let startDate = new Date()
    startDate.setMinutes(startDate.getMinutes() - 5)
    let expiryDate = new Date()
    expiryDate.setMinutes(expiryDate.getMinutes() + 10)

    var sharedAccessPolicy = {
        AccessPolicy: {
            Permissions: BlobUtilities.SharedAccessPermissions.READ,
            Start: startDate,
            Expiry: expiryDate,
        },
    }
    let sasToken = blobService.generateSharedAccessSignature(
        privateContainerName(),
        syeEnvironmentFile,
        sharedAccessPolicy
    )

    let envUrl = blobService.getUrl(privateContainerName(), syeEnvironmentFile, sasToken, true)
    let publicStorageUrl = blobService.getUrl(publicContainerName())

    const vmParameters: VirtualMachine = {
        location: region,
        osProfile: {
            computerName: vmName(machineName),
            adminUsername: 'netinsight',
            adminPassword: 'neti1A', // TODO Remove password
            customData: Buffer.from(
                `#!/bin/sh
cd /tmp
curl -O ${publicStorageUrl}/bootstrap.sh
chmod +x bootstrap.sh
ROLES="${roles}" PUBLIC_STORAGE_URL="${publicStorageUrl}" SYE_ENV_URL="${envUrl}" ATTACHED_STORAGE="${hasStorage}" ./bootstrap.sh --machine-name ${machineName} --machine-region ${region} --machine-zone ${availabilityZone} ${args}
            `
            ).toString('base64'),
        },
        hardwareProfile: {
            vmSize: instanceType,
        },
        storageProfile: {
            imageReference: {
                publisher: 'Canonical',
                offer: 'UbuntuServer',
                sku: '16.04-LTS',
                version: 'latest',
            },
            dataDisks: [],
        },

        networkProfile: {
            networkInterfaces: [
                {
                    id: networkInterface.id,
                    primary: true,
                },
            ],
        },
    }

    if (storage) {
        vmParameters.storageProfile.dataDisks.push({
            name: dataDiskName(machineName),
            lun: 0,
            diskSizeGB: storage,
            createOption: 'Empty',
            managedDisk: {
                storageAccountType: 'Premium_LRS',
            },
        })
    }

    let vmInfo = await computeClient.virtualMachines.createOrUpdate(clusterId, machineName, vmParameters)
    debug('vmInfo', vmInfo)
}

export async function machineDelete(clusterId: string, machineName: string) {
    validateClusterId(clusterId)

    let credentials = await getCredentials(clusterId)
    const subscription = await getSubscription(credentials, { resourceGroup: clusterId })

    const networkClient = new NetworkManagementClient(credentials, subscription.subscriptionId)
    const computeClient = new ComputeClient(credentials, subscription.subscriptionId)

    const vmInfo = await computeClient.virtualMachines.get(clusterId, vmName(machineName))
    await computeClient.virtualMachines.deleteMethod(clusterId, vmName(machineName))

    const promises = new Array<Promise<any>>()
    // Delete nics and public IP addresses
    if (vmInfo.networkProfile && vmInfo.networkProfile.networkInterfaces) {
        vmInfo.networkProfile.networkInterfaces.forEach(async (i) => {
            const nicName = i.id.substr(i.id.lastIndexOf('/') + 1)
            const nicInfo = await networkClient.networkInterfaces.get(clusterId, nicName)
            await networkClient.networkInterfaces.deleteMethod(clusterId, nicName)
            if (nicInfo.ipConfigurations) {
                nicInfo.ipConfigurations.forEach((ip) => {
                    const ipName = ip.publicIPAddress.id.substr(ip.publicIPAddress.id.lastIndexOf('/') + 1)
                    promises.push(networkClient.publicIPAddresses.deleteMethod(clusterId, ipName))
                })
            }
        })
    }
    // Delete OS disk and data disk
    if (vmInfo.storageProfile && vmInfo.storageProfile) {
        if (vmInfo.storageProfile.osDisk) {
            promises.push(computeClient.disks.deleteMethod(clusterId, vmInfo.storageProfile.osDisk.name))
        }
        if (vmInfo.storageProfile.dataDisks)
            vmInfo.storageProfile.dataDisks.forEach(async (d) => {
                promises.push(computeClient.disks.deleteMethod(clusterId, d.name))
            })
    }
    await Promise.all(promises)
}

export async function machineRedeploy(_clusterId: string, _region: string, _name: string) {}
