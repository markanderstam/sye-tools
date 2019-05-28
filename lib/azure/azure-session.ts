import { ResourceManagementClient } from '@azure/arm-resources'
import { ResourceGroup } from '@azure/arm-resources/esm/models'
import { NetworkManagementClient } from '@azure/arm-network'
import { ContainerServiceClient } from '@azure/arm-containerservice'
import { GraphRbacManagementClient } from '@azure/graph'
import { AuthorizationManagementClient } from '@azure/arm-authorization'
import { DnsManagementClient } from '@azure/arm-dns'
import { promisify } from 'util'
import * as fs from 'fs'
import { exit, consoleLog, sleep } from '../common'
import { Application, ServicePrincipal } from '@azure/graph/lib/models'
import { VirtualNetwork } from '@azure/arm-network/esm/models'
import * as uuidv4 from 'uuid/v4'
import { ManagedCluster } from '@azure/arm-containerservice/esm/models'
import { ComputeManagementClient } from '@azure/arm-compute'
import { StorageManagementClient } from '@azure/arm-storage'
import { SubscriptionClient } from '@azure/arm-subscriptions'
import { ContainerServiceVMSizeTypes } from '@azure/arm-containerservice/src/models/index'
import {
    loginWithServicePrincipalSecretWithAuthResponse,
    LinkedSubscription,
    AzureCliCredentials,
} from '@azure/ms-rest-nodeauth'
import { AzureStorageAccount } from './azure-storage-account'
import { ServiceClientCredentials } from '@azure/ms-rest-js'

const debug = require('debug')('azure/azure-session')

/**
 * Keeps track of the credentials and other details when making calls to the Azure APIs
 */
export class AzureSession {
    currentSubscription: {
        id: string
        name: string
        tenantId: string
        clientId: string
    }

    credentials: ServiceClientCredentials
    adCredentials: ServiceClientCredentials

    constructor() {}

    async init(options: { subscriptionNameOrId?: string; resourceGroup?: string }): Promise<AzureSession> {
        if (await this.loginUsingPrincipal(options)) {
            return this
        }
        if (await this.loginUsingCliCredentials(options)) {
            return this
        }

        throw new Error(`No login method was successful - cannot access Azure subscription`)
    }

    private async loginUsingCliCredentials(options: {
        subscriptionNameOrId?: string
        resourceGroup?: string
    }): Promise<boolean> {
        const creds = await AzureCliCredentials.create()
        this.credentials = creds
        this.adCredentials = await AzureCliCredentials.create({
            resource: 'https://graph.windows.net',
            subscriptionIdOrName: creds.subscriptionInfo.id,
        })
        if (!options.subscriptionNameOrId || options.subscriptionNameOrId === creds.subscriptionInfo.subscriptionId) {
            this.currentSubscription = {
                tenantId: creds.subscriptionInfo.tenantId,
                id: creds.subscriptionInfo.id,
                name: creds.subscriptionInfo.name,
                clientId: creds.subscriptionInfo.userId,
            }
            debug('Using the default subscription', {
                creds,
                currentSubscription: this.currentSubscription,
            })
            return true
        }

        // Let us change the subscriptionId, which should trigger refreshing the access token.
        const subscriptions = await AzureCliCredentials.listAllSubscriptions()
        debug('subscription list', subscriptions)
        const subscription = subscriptions.find(
            (s) => s.id === options.subscriptionNameOrId || s.name === options.subscriptionNameOrId
        )
        if (!subscription) {
            throw new Error(
                `Cannot find the subscription '${options.subscriptionNameOrId}' in ${JSON.stringify(
                    subscriptions,
                    null,
                    2
                )}`
            )
        }
        this.currentSubscription = {
            tenantId: subscription.tenantId,
            id: subscription.id,
            name: subscription.name,
            clientId: subscription.userId,
        }
        debug('currentSubscription', { currentSubscription: this.currentSubscription })
        return true
    }

    private async loginUsingPrincipal(options: {
        subscriptionNameOrId?: string
        resourceGroup?: string
    }): Promise<boolean> {
        const clientId = process.env.AZURE_CLIENT_ID
        let clientSecret = process.env.AZURE_CLIENT_SECRET
        let tenantId = process.env.AZURE_TENANT_ID
        if (!clientId && !clientSecret && !tenantId) {
            return false
        }
        if (!clientId || !clientSecret || !tenantId) {
            throw new Error(
                'All the environment variables AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and AZURE_TENANT_ID must be specified'
            )
        }

        debug('Login to Azure using service principal credentials')
        const authResponse = await loginWithServicePrincipalSecretWithAuthResponse(clientId, clientSecret, tenantId)
        debug('Login successful', authResponse)
        this.credentials = authResponse.credentials
        const currentSubscription = await this.matchLinkedSubscription(authResponse.subscriptions, options)
        this.currentSubscription = {
            id: currentSubscription.id,
            name: currentSubscription.name,
            clientId: clientId,
            tenantId: tenantId,
        }
        return true
    }

    private async matchLinkedSubscription(
        subscriptions: LinkedSubscription[],
        options: { subscriptionNameOrId?: string; resourceGroup?: string }
    ): Promise<LinkedSubscription> {
        const matchingSubscriptions: LinkedSubscription[] = []
        for (const subscription of subscriptions) {
            if (options.subscriptionNameOrId) {
                if (
                    subscription.name === options.subscriptionNameOrId ||
                    subscription.id === options.subscriptionNameOrId
                ) {
                    matchingSubscriptions.push(subscription)
                }
            } else {
                matchingSubscriptions.push(subscription)
            }
        }
        switch (matchingSubscriptions.length) {
            case 0:
                throw new Error('Could not find any matching subscription')
            case 1:
                return matchingSubscriptions[0]
            default:
                throw new Error(
                    `More than one matching subscription was found: ${matchingSubscriptions
                        .map((s) => s.name)
                        .join(', ')}`
                )
        }
    }

    networkManagementClient(): NetworkManagementClient {
        return new NetworkManagementClient(this.credentials, this.currentSubscription.id)
    }

    containerServiceClient(): ContainerServiceClient {
        return new ContainerServiceClient(this.credentials, this.currentSubscription.id)
    }

    graphRbacManagementClient(): GraphRbacManagementClient {
        return new GraphRbacManagementClient(this.adCredentials, this.currentSubscription.tenantId)
    }

    computeManagementClient(): ComputeManagementClient {
        return new ComputeManagementClient(this.credentials, this.currentSubscription.id)
    }

    resourceManagementClient(): ResourceManagementClient {
        return new ResourceManagementClient(this.credentials, this.currentSubscription.id)
    }

    storageManagementClient(): StorageManagementClient {
        return new StorageManagementClient(this.credentials, this.currentSubscription.id)
    }

    getAzureStorageAccount(
        resourceGroupName: string,
        location: string,
        storageAccountName: string
    ): AzureStorageAccount {
        return new AzureStorageAccount(this, resourceGroupName, location, storageAccountName)
    }

    dnsManagementClient(): DnsManagementClient {
        return new DnsManagementClient(this.credentials, this.currentSubscription.id)
    }

    subscriptionClient(): SubscriptionClient {
        return new SubscriptionClient(this.credentials)
    }

    authorizationManagementClient(): AuthorizationManagementClient {
        return new AuthorizationManagementClient(this.credentials, this.currentSubscription.id)
    }

    // ==> Standard Naming <==

    getHomepage(name: string): string {
        return `https://${name}`
    }

    // ==> AdApplication <==

    async createAdApplication(name: string): Promise<Application> {
        consoleLog(`Check if AD application '${name}' exists:`)
        const appList = await this.graphRbacManagementClient().applications.list({
            filter: `displayName eq '${name}'`,
        })
        switch (appList.length) {
            case 0:
                consoleLog('  Creating...')
                return await this.graphRbacManagementClient().applications.create({
                    availableToOtherTenants: false,
                    displayName: name,
                    identifierUris: [`http://${name}`],
                    homepage: this.getHomepage(name),
                })
            case 1:
                consoleLog('  Already exists - OK.')
                return appList[0]
            default:
                appList.forEach((app) => {
                    consoleLog(`  Found application with appId=${app.appId}`, true)
                })
                exit(`There are more than one AD application named '${name}'`)
                throw new Error('Duplicate AD applications found')
        }
    }

    async deleteAdApplication(name: string) {
        consoleLog(`Check if AD application '${name}' exists:`)
        const appList = await this.graphRbacManagementClient().applications.list({
            filter: `displayName eq '${name}'`,
        })
        switch (appList.length) {
            case 0:
                consoleLog('  Already deleted - OK.')
                break
            case 1:
                consoleLog('  Deleting...')
                await this.graphRbacManagementClient().applications.deleteMethod(appList[0].objectId)
                consoleLog('  Done.')
                break
            default:
                appList.forEach((app) => {
                    consoleLog(`  Found application with appId=${app.appId}`, true)
                })
                exit(`There are more than one AD application named '${name}'`)
                throw new Error('Duplicate AD applications found')
        }
    }

    // ==> ServicePrincipal <==

    /**
     * Get the named service principal, or null if none can be found
     */
    async getServicePrincipal(servicePrincipalName: string): Promise<ServicePrincipal | null> {
        const servicePrincipalHomePage = `http://${servicePrincipalName}`
        const graphClient = this.graphRbacManagementClient()
        const spList = await graphClient.servicePrincipals.list({
            filter: `displayName eq '${servicePrincipalName}'`,
        })
        debug('spList', spList)
        switch (spList.length) {
            case 0:
                return null
            case 1:
                return spList[0]
            default:
                throw new Error(
                    `Found more than one (${spList.length}) service principal named "${servicePrincipalHomePage}"`
                )
        }
    }

    async createServicePrincipal(
        name: string,
        password: string,
        adApplication: Application
    ): Promise<ServicePrincipal> {
        consoleLog(`Check if service principal '${name}' exists:`)
        const sp = await this.getServicePrincipal(name)
        if (sp) {
            consoleLog('  Already exists - OK.')
            return sp
        }
        consoleLog('  Creating...')
        const createdSp = await this.graphRbacManagementClient().servicePrincipals.create({
            appId: adApplication.appId,
            displayName: name,
            homepage: this.getHomepage(name),
            passwordCredentials: [
                {
                    value: password,
                    endDate: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000), // Approx 10 years
                },
            ],
        })
        consoleLog('  Wait for it to appear...')
        while (!(await this.getServicePrincipal(name))) {
            await sleep(10000)
        }
        consoleLog('  Done.')
        return createdSp
    }

    async deleteServicePrincipal(name: string) {
        consoleLog(`Deleting service principal ${name}:`)
        const spList = await this.graphRbacManagementClient().servicePrincipals.list({
            filter: `displayName eq '${name}'`,
        })
        switch (spList.length) {
            case 0:
                consoleLog('  Already deleted - OK.')
                break
            case 1:
                consoleLog('  Deleting...')
                await this.graphRbacManagementClient().servicePrincipals.deleteMethod(spList[0].objectId)
                break
            default:
                throw new Error(`Got more than one match on service principal: ${name}`)
        }
        consoleLog('  Done.')
    }

    // ==> RoleDefinition <==

    async deleteRoleDefinition(name: string, scope: string) {
        consoleLog(`Deleting role definition ${name} in ${scope}:`)
        const roleList = await this.authorizationManagementClient().roleDefinitions.list(scope, {
            filter: `name eq '${name}'`,
        })
        switch (roleList.length) {
            case 0:
                consoleLog('  Already deleted - OK.')
                break
            case 1:
                consoleLog('  Deleting...')
                await this.authorizationManagementClient().roleDefinitions.deleteMethod(scope, roleList[0].id)
                consoleLog('  Done.')
                break
            default:
                throw new Error(`Found more than one matching role definition: count=${roleList.length}`)
        }
    }

    // ==> Role Assignment <==

    /**
     * Magic name for the contributor role in Azure.
     * See: https://docs.microsoft.com/en-us/azure/role-based-access-control/built-in-roles#contributor
     */
    readonly CONTRIBUTOR_ROLE_NAME = 'b24988ac-6180-42a0-ab88-20f7382dd24c'

    readonly NETWORK_CONTRIBUTOR_ROLE_NAME = '4d97b98b-1d4f-4787-a291-c67834d212e7'

    readonly STORAGE_ACCOUNT_CONTRIBUTOR_ROLE_NAME = '17d1049b-9a84-46fb-8f53-869881c3d3ab'

    getRoleDefinitionId(roleId: string): string {
        return `/subscriptions/${this.currentSubscription.id}/providers/Microsoft.Authorization/roleDefinitions/${roleId}`
    }

    getVnetScope(resourceGroup: string, vnetName: string): string {
        return `${this.getResourceGroupScope(resourceGroup)}/providers/Microsoft.Network/virtualNetworks/${vnetName}`
    }

    getSubnetScope(resourceGroup: string, vnetName: string, subnetName: string): string {
        return `${this.getVnetScope(resourceGroup, vnetName)}/subnets/${subnetName}`
    }

    getResourceGroupScope(resourceGroup: string): string {
        return `/subscriptions/${this.currentSubscription.id}/resourceGroups/${resourceGroup}`
    }

    async assignRoleToServicePrincipal(servicePrincipal: ServicePrincipal, scope: string, roleDefinitionId: string) {
        consoleLog('Role for service principal:')
        consoleLog('  Getting existing roles...')

        // The roles that the application object has does not contain roles of sub-objects
        // Thus we need to look them up specifically
        const roleAssignmentList = await this.authorizationManagementClient().roleAssignments.list({
            filter: `principalId eq '${servicePrincipal.objectId}'`,
        })
        const filteredRoleAssignmentList = roleAssignmentList.filter(
            (ra) => ra.scope === scope && ra.roleDefinitionId === roleDefinitionId
        )
        switch (filteredRoleAssignmentList.length) {
            case 0:
                consoleLog('  Creating role...')
                const uuid = uuidv4()
                debug('Create role', { scope, uuid, roleDefinitionId, servicePrincipal })
                const roleAssignment = await this.authorizationManagementClient().roleAssignments.create(scope, uuid, {
                    roleDefinitionId: roleDefinitionId,
                    principalId: servicePrincipal.objectId,
                    principalType: servicePrincipal.objectType,
                })
                debug('roleAssignment', roleAssignment)
                consoleLog('  Done.')
                break
            case 1:
                debug('roleAssignment', filteredRoleAssignmentList[0])
                consoleLog('  Role already exists - OK.')
                break
            default:
                throw new Error(
                    `Found more than one matching role assignment for the application ${
                        servicePrincipal.objectId
                    }: ${JSON.stringify(filteredRoleAssignmentList)}`
                )
        }
    }

    // ==> ResourceGroup <==

    async createResourceGroup(name: string, location: string): Promise<ResourceGroup> {
        try {
            consoleLog(`Resource group ${name}:`)
            const resourceGroup = await this.resourceManagementClient().resourceGroups.get(name)
            consoleLog('  Already exists - OK.')
            return resourceGroup
        } catch (ex) {
            consoleLog('  Creating...')
            const resourceGroup = await this.resourceManagementClient().resourceGroups.createOrUpdate(name, {
                location: location,
            })
            consoleLog('  Done.')
            return resourceGroup
        }
    }

    async deleteResourceGroup(name: string) {
        try {
            consoleLog(`Check if resource group "${name}" exists:`)
            await this.resourceManagementClient().resourceGroups.get(name)
            consoleLog('  Deleting...')
            await this.resourceManagementClient().resourceGroups.deleteMethod(name)
            consoleLog('  Done.')
        } catch (ex) {
            consoleLog('  Already deleted - OK.')
        }
    }

    // ==> VNET <==

    async createVnet(name: string, resourceGroup: string, location: string, cidr: string): Promise<VirtualNetwork> {
        try {
            consoleLog(`Virtual network ${name}:`)
            const vnet = await this.networkManagementClient().virtualNetworks.get(resourceGroup, name)
            consoleLog('  Already exists - OK.')
            return vnet
        } catch (ex) {
            consoleLog('  Creating...')
            const vnet = await this.networkManagementClient().virtualNetworks.createOrUpdate(resourceGroup, name, {
                location: location,
                name: name,
                addressSpace: {
                    addressPrefixes: [cidr],
                },
                dhcpOptions: {
                    dnsServers: [],
                },
                tags: {},
            })
            consoleLog('  Done.')
            return vnet
        }
    }

    // ==> SubNet <==

    async createSubnet(resourceGroup: string, vnetName: string, subnetName: string, subnetCidr: string) {
        const networkClient = this.networkManagementClient()

        try {
            consoleLog(`Subnet ${subnetName}:`)
            const subnet = await networkClient.subnets.get(resourceGroup, vnetName, subnetName)
            if (subnet) {
                consoleLog('  Already exists - OK.')
                return
            }
        } catch (ex) {
            debug('Ignored exception', ex.toString())
        }
        consoleLog('  Creating...')
        const subnet = await networkClient.subnets.createOrUpdate(resourceGroup, vnetName, subnetName, {
            addressPrefix: subnetCidr,
        })
        if (!subnet) {
            throw new Error('Could not create the subnet for the cluster')
        }
        debug('Subnet created', subnet)
        consoleLog('  Done.')
    }

    async deleteSubnet(resourceGroup: string, subnetName: string, vnetName: string) {
        try {
            consoleLog(`Deleting subnet "${subnetName}"`)
            debug('Check if subnet exists', { vnet: vnetName, subnet: subnetName })
            await this.networkManagementClient().subnets.get(resourceGroup, vnetName, subnetName)
            consoleLog(`  Deleting subnet "${subnetName}"`)
            await this.networkManagementClient().subnets.deleteMethod(resourceGroup, vnetName, subnetName)
            consoleLog(`  Subnet "${subnetName}" was deleted`)
        } catch (ex) {
            consoleLog(`  Subnet "${subnetName}" already deleted`)
        }
    }

    // ==> NSG <==

    private getNsgRuleName(protocol: 'Tcp' | 'Udp', portNumber: number): string {
        return `${protocol.toUpperCase()}_${portNumber}`
    }

    async openPortInNsg(
        startPortNumber: number,
        endPortNumber: number,
        protocol: 'Udp' | 'Tcp',
        priority: number,
        description: string,
        resourceGroup: string
    ) {
        const ruleName = this.getNsgRuleName(protocol, startPortNumber)
        consoleLog(`Enable port ${protocol}/${startPortNumber}-${endPortNumber} network security rules:`)
        consoleLog('  Finding NSG...')
        const networkClient = this.networkManagementClient()
        const nsgList = await networkClient.networkSecurityGroups.list(resourceGroup)
        debug('Found NSGs', nsgList)
        switch (nsgList.length) {
            case 0:
                throw new Error('Did not find any NSG')
            case 1:
                break
            default:
                throw new Error(`More than one NSG was found ${nsgList.map((e) => e.id)}`)
        }
        const nsgName = nsgList[0].name
        consoleLog('  Create/update NSG rule...')
        await networkClient.securityRules.createOrUpdate(resourceGroup, nsgName, ruleName, {
            priority,
            protocol,
            access: 'Allow',
            direction: 'Inbound',
            sourceAddressPrefix: '*',
            sourcePortRange: '*',
            destinationAddressPrefix: '*',
            destinationPortRange:
                startPortNumber === endPortNumber ? `${startPortNumber}` : `${startPortNumber}-${endPortNumber}`,
            description,
        })
        consoleLog('  Done.')
    }

    // ==> AKS <==

    async listAksClusters(): Promise<ManagedCluster[]> {
        return await this.containerServiceClient().managedClusters.list({})
    }

    async getAksCluster(p: { resourceGroup: string; clusterName: string }): Promise<ManagedCluster> {
        return await this.containerServiceClient().managedClusters.get(p.resourceGroup, p.clusterName)
    }

    private getAdminUsername(): string {
        return 'netinsight'
    }

    async createCluster(options: {
        name: string
        resourceGroup: string
        location: string
        release: string
        nodePoolName: string
        count: number
        vmSize: ContainerServiceVMSizeTypes
        enableAutoScaling: boolean
        minCount: number
        maxCount: number
        password: string
        cidr: string
        servicePrincipalName: string
        vnetName: string
        subnetName: string
        publicKeyPath?: string
        maxPods?: number
    }): Promise<ManagedCluster> {
        const containerServiceClient = this.containerServiceClient()
        try {
            consoleLog(`AKS Cluster ${options.name}:`)
            const aksCluster = await containerServiceClient.managedClusters.get(options.resourceGroup, options.name)
            if (aksCluster) {
                consoleLog('  Already exists - OK.')
                return aksCluster
            }
        } catch (ex) {
            debug('Ignored exception', ex.toString())
        }
        consoleLog('  Getting appId...')
        const graphClient = this.graphRbacManagementClient()
        const spList = await graphClient.servicePrincipals.list({
            filter: `displayName eq '${options.servicePrincipalName}'`,
        })
        if (spList.length !== 1) {
            throw new Error(`Could not find the service principal - got ${spList.length} matches`)
        }
        const appId = spList[0].appId
        debug('appId', appId)
        consoleLog('  Getting subnet id...')
        const networkClient = this.networkManagementClient()
        debug('mgmt')
        const subnet = await networkClient.subnets.get(options.resourceGroup, options.vnetName, options.subnetName)
        debug('subnetId', subnet.id)
        consoleLog('  Reading SSH public key...')
        const publicKey = await promisify(fs.readFile)(options.publicKeyPath || `${process.env.HOME}/.ssh/id_rsa.pub`)
        debug('SSH public key', publicKey)
        const parameters: ManagedCluster = {
            location: options.location,
            kubernetesVersion: options.release,
            agentPoolProfiles: [
                {
                    name: options.nodePoolName,
                    count: options.count,
                    vmSize: options.vmSize,
                    vnetSubnetID: subnet.id,
                    maxPods: options.maxPods,
                    osType: 'Linux',
                    type: 'VirtualMachineScaleSets',
                    enableAutoScaling: options.minCount > 0,
                    minCount: options.minCount > 0 ? options.minCount : undefined,
                    maxCount: options.minCount > 0 ? options.maxCount : undefined,
                },
            ],
            linuxProfile: {
                adminUsername: this.getAdminUsername(),
                ssh: {
                    publicKeys: [{ keyData: publicKey.toString() }],
                },
            },
            servicePrincipalProfile: {
                clientId: appId,
                secret: options.password,
            },
            enableRBAC: true,
            networkProfile: {
                networkPlugin: 'azure',
                // Using default: networkPolicy: '',
                podCidr: options.cidr,
            },
            dnsPrefix: options.name,
        }
        debug('parameters', parameters)
        consoleLog('  Creating AKS cluster...')
        const cluster = await containerServiceClient.managedClusters.createOrUpdate(
            options.resourceGroup,
            options.name,
            parameters
        )
        debug('Cluster created', cluster)
        consoleLog('  Done.')
        return cluster
    }

    async updateAksCluster(
        clusterName: string,
        resourceGroup: string,
        cluster: ManagedCluster
    ): Promise<ManagedCluster> {
        return await this.containerServiceClient().managedClusters.createOrUpdate(resourceGroup, clusterName, cluster)
    }

    async deleteCluster(clusterName: string, resourceGroup: string) {
        try {
            debug('Check if AKS cluster exists', { name: clusterName })
            await this.containerServiceClient().managedClusters.get(resourceGroup, clusterName)
            consoleLog(`Deleting AKS cluster "${clusterName}"`)
            await this.containerServiceClient().managedClusters.deleteMethod(resourceGroup, clusterName)
            consoleLog(`AKS cluster "${clusterName}" was deleted`)
        } catch (ex) {
            consoleLog(`AKS cluster "${clusterName}" already deleted`)
        }
    }

    async enableVmssPublicIps(k8sResourceGroup: string, publicKeyPath: string) {
        const publicKey = (await promisify(fs.readFile)(
            publicKeyPath || `${process.env.HOME}/.ssh/id_rsa.pub`
        )).toString()
        debug('public SSH key', publicKey)
        const vmssClient = this.computeManagementClient().virtualMachineScaleSets
        const response = await vmssClient.list(k8sResourceGroup)
        consoleLog(`Adding public IPs to VMs in AKS cluster`)
        for (const vmss of response) {
            consoleLog(`  Checking ${vmss.name}...`)
            const primaryProfile = vmss.virtualMachineProfile.networkProfile.networkInterfaceConfigurations.find(
                (ip) => ip.primary
            )
            if (!primaryProfile) {
                throw new Error(`No primary network interface configuration found for ${vmss.name}`)
            }
            const primaryIpConfig = primaryProfile.ipConfigurations.find((ip) => ip.primary)
            if (!primaryIpConfig) {
                throw new Error(`No primary ip config for profile ${primaryProfile.name} in ${vmss.name}`)
            }

            if (!primaryIpConfig.publicIPAddressConfiguration) {
                consoleLog(`  Adding public IP to ${vmss.name}...`)
                primaryIpConfig.publicIPAddressConfiguration = {
                    name: 'pub1',
                }
                consoleLog(`  Patching ${vmss.name}...`)
                await vmssClient.createOrUpdate(k8sResourceGroup, vmss.name, vmss)
                consoleLog(`  Upgrading VMs in ${vmss.name}...`)
                const response = await vmssClient.updateInstances(k8sResourceGroup, vmss.name, { instanceIds: ['*'] })
                consoleLog(`  Upgrade response: ${response.status}`)
            } else {
                consoleLog(`  Skipping ${vmss.name}...`)
            }
        }
        consoleLog('  Done')
    }
}
