import { isIPv6 } from 'net'
import { AzureSession } from '../../lib/azure/azure-session'

const debug = require('debug')('dns')

export function createDnsRecord(
    name: string,
    ip: string,
    ttl = 300,
    subscription?: string,
    updateIfExists?: boolean
): Promise<void> {
    return changeDnsRecord(name, ip, 'CREATE', subscription, ttl, updateIfExists)
}

export function deleteDnsRecord(name: string, ip: string, subscription?: string): Promise<void> {
    return changeDnsRecord(name, ip, 'DELETE', subscription)
}

async function changeDnsRecord(
    name: string,
    ip: string,
    change: 'CREATE' | 'DELETE',
    subscriptionNameOrId?: string,
    ttl?: number,
    updateIfExists?: boolean
): Promise<void> {
    const type = isIPv6(ip) ? 'AAAA' : 'A'
    const [, relativeRecordSetName, zone] = name.match(/(^.+?)\.(.+$)/)

    const azureSession = await new AzureSession().init({ subscriptionNameOrId })
    const dnsClient = azureSession.dnsManagementClient()

    const resource = (await dnsClient.zones.list()).find((z) => z.name === zone)
    if (!resource) {
        throw `Could not find any matching zone for ${zone}`
    }

    const [, resourceGroupName] = resource.id.match(/resourceGroups\/(.+?)\//)
    const records = await dnsClient.recordSets.listByDnsZone(resourceGroupName, zone)

    switch (change) {
        case 'CREATE':
            if (!updateIfExists && records.some((r) => r.name === relativeRecordSetName)) {
                throw `DNS record ${name} already exists`
            }
            const result = await dnsClient.recordSets.createOrUpdate(
                resourceGroupName,
                zone,
                relativeRecordSetName,
                type,
                {
                    tTL: ttl,
                    aRecords: type === 'A' ? [{ ipv4Address: ip }] : undefined,
                    aaaaRecords: type === 'AAAA' ? [{ ipv6Address: ip }] : undefined,
                }
            )
            debug('Created:', result)
            break
        case 'DELETE':
            if (
                !records.some(
                    (r) =>
                        r.name === relativeRecordSetName &&
                        (type === 'A'
                            ? r.aRecords.some((aR) => aR.ipv4Address === ip)
                            : r.aaaaRecords.some((aaaaR) => aaaaR.ipv6Address === ip))
                )
            ) {
                throw `Found no record ${name} with ip ${ip}`
            }
            await dnsClient.recordSets.deleteMethod(resourceGroupName, zone, relativeRecordSetName, type)
            break
    }
    await azureSession.save()
}
