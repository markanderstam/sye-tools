import * as cp from 'child_process'
import { consoleLog } from '../../lib/common'
import { AzureSession } from '../../lib/azure/azure-session'

const debug = require('debug')('aks/utils')

export function exec(
    cmd: string,
    args: string[],
    options: { input?: string; env?: Object; failOnStderr?: boolean } = {}
): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
        let command = cmd
        for (const arg of args) {
            command += ' '
            command += "'"
            command += arg
            command += "'"
        }
        debug(`EXEC: ${command}`, { options })
        const childProcess = cp.exec(command, options, (error, stdout, stderr) => {
            if (error) {
                reject(error.message)
            } else {
                if (stderr && options.failOnStderr) {
                    reject(stderr.toString())
                } else {
                    resolve(stdout.split('\n'))
                }
            }
        })
        if (options.input) {
            childProcess.stdin.write(options.input)
            childProcess.stdin.end()
        }
    })
}

export async function ensurePublicIps(
    azureSession: AzureSession,
    clusterName: string,
    k8sResourceGroup: string,
    location: string
) {
    consoleLog(`Adding public IPs to VMs in AKS cluster ${clusterName}:`)
    consoleLog('  Listing VMs...')
    const vms = await azureSession.computeManagementClient().virtualMachines.list(k8sResourceGroup)
    consoleLog('  Listing NICs...')
    const nicList = await azureSession.networkManagementClient().networkInterfaces.list(k8sResourceGroup)

    const usedPublicIpNames: string[] = []
    for (const vm of vms.filter((x) => !!x)) {
        const publicIpName = `${vm.name}-public-ip`
        usedPublicIpNames.push(publicIpName)
        consoleLog(`  Inspecting VM ${vm.name}...`)
        try {
            const publicIp = await azureSession
                .networkManagementClient()
                .publicIPAddresses.get(k8sResourceGroup, publicIpName)
            debug('Public IP for the VM was found', publicIp)
            consoleLog(`    Public IP for VM "${vm.name}" already exists - OK.`)
        } catch (ex) {
            consoleLog('    Adding public IP...')
            const publicIp = await azureSession
                .networkManagementClient()
                .publicIPAddresses.createOrUpdate(k8sResourceGroup, publicIpName, {
                    location: location,
                    publicIPAllocationMethod: 'Dynamic',
                })
            consoleLog('    Finding NIC...')
            const nic = nicList.find((n) => n.id === vm.networkProfile.networkInterfaces[0].id)
            consoleLog('    Finding IpConfiguration...')
            const primaryIpConfig = nic.ipConfigurations.find((n) => n.primary)
            debug('primaryIpConfig', primaryIpConfig)
            const nicName = nic.id.split('/').pop()
            debug('nicId', { id: nic.id, name: nicName })
            primaryIpConfig.publicIPAddress = publicIp
            consoleLog('    Updating NIC...')
            await azureSession
                .networkManagementClient()
                .networkInterfaces.createOrUpdate(k8sResourceGroup, nicName, nic)

            consoleLog('    Public IP Configured - OK.')
        }
    }
    consoleLog('  All VMs have their Public IPs configured')
    consoleLog('  Check for unused public IPs')
    const publicIps = await azureSession.networkManagementClient().publicIPAddresses.list(k8sResourceGroup)
    for (const publicIp of publicIps) {
        if (publicIp.name.endsWith('-public-ip') && !usedPublicIpNames.find((name) => name === publicIp.name)) {
            consoleLog(`  Found unused public ip: ${publicIp.name} - deleting it`)
            await azureSession.networkManagementClient().publicIPAddresses.deleteMethod(k8sResourceGroup, publicIp.name)
            consoleLog('  Done')
        }
    }
}
