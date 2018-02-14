import * as dbg from 'debug'
const debug = dbg('azure/machine')
import NetworkManagementClient = require('azure-arm-network')
import {validateClusterId, getCredentials, vmName, publicIpName, ipConfigName, nicName, vnetName, subnetName, publicContainerName, privateContainerName} from './common'
import ComputeClient = require('azure-arm-compute')
import {exit} from '../../lib/common'

const SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID

export async function machineAdd(
    clusterId: string,
    region: string,
    availabilityZone: string,
    machineName: string,
    instanceType: string,
    roles: string[],
    management: boolean,
    _storage: number) {
    let args = ''
    if( management ) {
        args += ' --management eth0'
    }

    validateClusterId(clusterId)

    let credentials = await getCredentials(clusterId)

    const networkClient = new NetworkManagementClient(credentials, SUBSCRIPTION_ID)
    const computeClient = new ComputeClient(credentials, SUBSCRIPTION_ID)
    let subnetInfo = await networkClient.subnets.get(clusterId, vnetName(region), subnetName(region))

    // Check if machine exists before trying to create it
    try {
        let existingVm = await computeClient.virtualMachines.get(clusterId, vmName(machineName))
        debug('existingVm', existingVm)
        exit(`Machine ${machineName} already exists`)
    }
    catch (e) {
        if( e.code !== 'ResourceNotFound')
            throw e
    }

    let publicIPParameters = {
        location: region,
        publicIPAllocationMethod: 'Dynamic',
      }

    let publicIPInfo = await networkClient.publicIPAddresses.createOrUpdate(clusterId, publicIpName(machineName), publicIPParameters)

    debug('publicIPInfo', publicIPInfo)

    // Need to configure SR-IOV here!
    let nicParameters = {
        location: region,
        ipConfigurations: [
          {
            name: ipConfigName(machineName),
            privateIPAllocationMethod: 'Dynamic',
            subnet: subnetInfo,
            publicIPAddress: publicIPInfo
          }
        ]
      }

    let networkInterface = await networkClient.networkInterfaces.createOrUpdate(clusterId, nicName(machineName), nicParameters)

    debug('networkInterface', networkInterface)

    // let imageInfo = await computeClient.virtualMachineImages.list(region, 'Canonical', 'UbuntuServer', '16.04-LTS', { top: 1 }) // Finds the OLDEST version
    // let version = imageInfo[0].name
    // debug('imageInfo', imageInfo)

    let envUrl = `https://${clusterId}.blob.core.windows.net/${privateContainerName()}/sye-environment.tar.gz`
    let publicStorageUrl = `https://${clusterId}.blob.core.windows.net/${publicContainerName()}`
    const vmParameters = {
        location: region,
        osProfile: {
            computerName: vmName(machineName),
            adminUsername: 'netinsight',
            adminPassword: 'neti1A', // TODO Remove password
            customData: Buffer.from(`#!/bin/sh
cd /tmp
curl -O ${publicStorageUrl}/bootstrap.sh
chmod +x bootstrap.sh
ROLES="${roles}" PUBLIC_STORAGE_URL="${publicStorageUrl}" SYE_ENV_URL="${envUrl}" ./bootstrap.sh --machine-name ${machineName} --machine-region ${region} --machine-zone ${availabilityZone} ${args}
            `).toString('base64')
        },
        hardwareProfile: {
            vmSize: instanceType
        },
        storageProfile: {
            imageReference: {
                publisher: 'Canonical',
                offer: 'UbuntuServer',
                sku: '16.04-LTS',
                version: 'latest'
            },
        },
        networkProfile: {
            networkInterfaces: [
            {
                id: networkInterface.id,
                primary: true
            }
            ]
        }
    }

    let vmInfo = await computeClient.virtualMachines.createOrUpdate(clusterId, machineName, vmParameters)
    debug('vmInfo', vmInfo)
}

export async function machineDelete(_clusterId: string, _region: string, _name: string) {

}

export async function machineRedeploy(_clusterId: string, _region: string, _name: string) {

}

