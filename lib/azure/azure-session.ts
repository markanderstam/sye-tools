import { SubscriptionClient } from 'azure-arm-resource'
import { Subscription } from 'azure-arm-resource/lib/subscription/models'
import { FileTokenCache } from './file-token-cache'
import {
    LinkedSubscription,
    DeviceTokenCredentials,
    ApplicationTokenCredentials,
    UserTokenCredentials,
    interactiveLoginWithAuthResponse,
    loginWithServicePrincipalSecretWithAuthResponse,
} from 'ms-rest-azure'
import { NetworkManagementClient } from 'azure-arm-network'
import { ContainerServiceClient } from 'azure-arm-containerservice'
import { GraphRbacManagementClient } from 'azure-graph'
import ComputeManagementClient = require('azure-arm-compute')
import { ResourceManagementClient } from 'azure-arm-resource'
import StorageManagementClient = require('azure-arm-storage')
import { AuthorizationManagementClient } from 'azure-arm-authorization'
import DnsManagementClient from 'azure-arm-dns'
import { promisify } from 'util'
import * as fs from 'fs'
import { deleteFile } from '../common'
import { writeJsonFile } from '../common'
import { mkdir } from '../common'
import { exit } from '../common'
import { readJsonFile } from '../common'
import { Application, ServicePrincipal } from 'azure-graph/lib/models'
import { consoleLog } from '../common'
import { sleep } from '../common'
import { ResourceModels } from 'azure-arm-resource'
import { VirtualNetwork } from 'azure-arm-network/lib/models'
import * as uuidv4 from 'uuid/v4'
import { ManagedCluster } from 'azure-arm-containerservice/lib/models'

const debug = require('debug')('azure/azure-session')

const AZURE_TOKENS_PATH = `${process.env.HOME}/.azure/accessTokens.json`
const AZURE_PROFILE_PATH = `${process.env.HOME}/.azure/azureProfile.json`
const SYE_DIR = `${process.env.HOME}/.sye`
const SYE_TOKENS_FILE = `azureAccessTokens.json`
const SYE_PROFILE_FILE = `azureProfile.json`
const SYE_TOKENS_PATH = `${SYE_DIR}/${SYE_TOKENS_FILE}`
const SYE_PROFILE_PATH = `${SYE_DIR}/${SYE_PROFILE_FILE}`

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

    credentials: DeviceTokenCredentials | ApplicationTokenCredentials | UserTokenCredentials
    adCredentials: DeviceTokenCredentials | ApplicationTokenCredentials | UserTokenCredentials

    private readonly tokenCache: FileTokenCache = new FileTokenCache()

    private credentialSource: 'sp' | 'sye' | 'cli' | null = null

    constructor() {}

    async login(subscriptionNameOrId?: string): Promise<void> {
        const authResponse = await interactiveLoginWithAuthResponse({
            tokenCache: this.tokenCache,
        })
        debug('Login successful', authResponse)
        this.credentials = authResponse.credentials
        const currentSubscription = await this.matchLinkedSubscription(authResponse.subscriptions, {
            subscriptionNameOrId,
        })
        const token = this.tokenCache.first()
        this.currentSubscription = {
            id: currentSubscription.id,
            name: currentSubscription.name,
            clientId: token.userId,
            tenantId: token.tenantId,
        }
        await mkdir(SYE_DIR)
        await this.tokenCache.save(SYE_TOKENS_PATH)
        await writeJsonFile(SYE_PROFILE_PATH, {
            subscriptionId: currentSubscription.id,
            tenantId: currentSubscription.tenantId,
        })
    }

    async logout(): Promise<void> {
        await deleteFile(SYE_TOKENS_PATH)
        await deleteFile(SYE_PROFILE_PATH)
    }

    async init(options: { subscriptionNameOrId?: string; resourceGroup?: string }): Promise<AzureSession> {
        if (await this.loginUsingPrincipal(options)) {
            this.credentialSource = 'sp'
            return this
        }

        await this.tokenCache.load(SYE_TOKENS_PATH)
        this.credentialSource = 'sye'
        if (this.tokenCache.empty()) {
            await this.tokenCache.load(AZURE_TOKENS_PATH)
            this.credentialSource = 'cli'
        }
        if (this.tokenCache.empty()) {
            this.credentialSource = null
            exit('Not logged on, please use either "az login" or "sye azure login" to login')
        }

        let tenantId: string
        switch (this.credentialSource) {
            case 'sye':
                const syeProfile = await readJsonFile(SYE_PROFILE_PATH)
                if (syeProfile) {
                    options.subscriptionNameOrId = options.subscriptionNameOrId || syeProfile.subscriptionId
                    tenantId = syeProfile.tenantId
                }
                break
            case 'cli':
                const azureProfile = await readJsonFile(AZURE_PROFILE_PATH)
                debug(AZURE_PROFILE_PATH, azureProfile)
                if (azureProfile) {
                    const defaultSubscription = azureProfile.subscriptions.find((s) => s.isDefault)
                    options.subscriptionNameOrId = options.subscriptionNameOrId || defaultSubscription.id
                    tenantId = defaultSubscription.tenantId
                }
                break
            default:
                throw new Error(`Invalid credentialSource: ${this.credentialSource}`)
        }
        debug('Find subscription options', options)

        const token = this.tokenCache.first()
        debug('Selected token')
        this.credentials = new DeviceTokenCredentials({ tokenCache: this.tokenCache, username: token.userId })
        this.adCredentials = new DeviceTokenCredentials({
            tokenCache: this.tokenCache,
            username: token.userId,
            tokenAudience: '00000002-0000-0000-c000-000000000000',
        })
        debug('credentials', this.credentials)
        const subscriptionClient = new SubscriptionClient(this.credentials)
        const subscriptionList = await subscriptionClient.subscriptions.list()
        const currentSubscription = await this.matchSubscription(subscriptionList, options)
        tenantId = tenantId || token.tenantId
        if (!tenantId) {
            const tenantList = await subscriptionClient.tenants.list()
            tenantId = tenantList[0].tenantId
        }
        this.currentSubscription = {
            tenantId: tenantId,
            id: currentSubscription.subscriptionId,
            name: currentSubscription.displayName,
            clientId: token.userId,
        }
        return this
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
        const authResponse = await loginWithServicePrincipalSecretWithAuthResponse(
            clientId,
            clientSecret,
            this.currentSubscription.tenantId
        )
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

    private async matchSubscription(
        subscriptions: Subscription[],
        options: { subscriptionNameOrId?: string; resourceGroup?: string }
    ): Promise<Subscription> {
        const matchingSubscriptions: Subscription[] = []
        for (const subscription of subscriptions) {
            if (options.subscriptionNameOrId) {
                if (
                    subscription.displayName === options.subscriptionNameOrId ||
                    subscription.subscriptionId === options.subscriptionNameOrId
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
                        .map((s) => s.displayName)
                        .join(', ')}`
                )
        }
    }

    async save(): Promise<void> {
        if (this.credentialSource !== 'sye') {
            return
        }
        if (!(await promisify(fs.stat)(SYE_DIR))) {
            await promisify(fs.mkdir)(SYE_DIR)
        }
        await this.tokenCache.save(SYE_TOKENS_PATH)
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
        return `/subscriptions/${
            this.currentSubscription.id
        }/providers/Microsoft.Authorization/roleDefinitions/${roleId}`
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

    async createResourceGroup(name: string, location: string): Promise<ResourceModels.ResourceGroup> {
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
        portNumber: number,
        protocol: 'Udp' | 'Tcp',
        priority: number,
        description: string,
        resourceGroup: string
    ) {
        const ruleName = this.getNsgRuleName(protocol, portNumber)
        consoleLog(`Enable port ${protocol}/${portNumber} network security rules:`)
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
        try {
            consoleLog('  Inspecting NSG Rule...')
            const rule = await networkClient.securityRules.get(resourceGroup, nsgName, ruleName)
            if (rule) {
                debug('NSG rule', rule)
                consoleLog('  Already configured - OK.')
                return
            }
        } catch (ex) {
            debug('Ignored exception', ex.toString())
        }
        consoleLog('  Configure NSG rule...')
        await networkClient.securityRules.createOrUpdate(resourceGroup, nsgName, ruleName, {
            priority,
            protocol,
            access: 'Allow',
            direction: 'Inbound',
            sourceAddressPrefix: '*',
            sourcePortRange: '*',
            destinationAddressPrefix: '*',
            destinationPortRange: `${portNumber}`,
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

    async createCluster(
        clusterName: string,
        resourceGroup: string,
        location: string,
        kubernetesVersion: string,
        nodePools: NodePool[],
        password: string,
        cidr: string,
        servicePrincipalName: string,
        vnetName: string,
        subnetName: string
    ): Promise<ManagedCluster> {
        const containerServiceClient = this.containerServiceClient()
        try {
            consoleLog(`AKS Cluster ${clusterName}:`)
            const aksCluster = await containerServiceClient.managedClusters.get(resourceGroup, clusterName)
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
            filter: `displayName eq '${servicePrincipalName}'`,
        })
        if (spList.length !== 1) {
            throw new Error(`Could not find the service principal - got ${spList.length} matches`)
        }
        const appId = spList[0].appId
        debug('appId', appId)
        consoleLog('  Getting subnet id...')
        const networkClient = this.networkManagementClient()
        debug('mgmt')
        const subnet = await networkClient.subnets.get(resourceGroup, vnetName, subnetName)
        debug('subnetId', subnet.id)
        consoleLog('  Reading SSH public key...')
        const publicKey = await promisify(fs.readFile)(`${process.env.HOME}/.ssh/id_rsa.pub`)
        debug('SSH public key', publicKey)
        const parameters: ManagedCluster = {
            location: location,
            kubernetesVersion: kubernetesVersion,
            agentPoolProfiles: [],
            linuxProfile: {
                adminUsername: this.getAdminUsername(),
                ssh: {
                    publicKeys: [{ keyData: publicKey.toString() }],
                },
            },
            servicePrincipalProfile: {
                clientId: appId,
                secret: password,
            },
            enableRBAC: true,
            networkProfile: {
                networkPlugin: 'azure',
                // Using default: networkPolicy: '',
                podCidr: cidr,
            },
            dnsPrefix: clusterName,
        }
        for (const nodePool of nodePools) {
            parameters.agentPoolProfiles.push({
                name: nodePool.name,
                count: nodePool.count,
                vmSize: nodePool.vmSize,
                vnetSubnetID: subnet.id,
            })
        }
        debug('parameters', parameters)
        consoleLog('  Creating AKS cluster...')
        const cluster = await containerServiceClient.managedClusters.createOrUpdate(
            resourceGroup,
            clusterName,
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
}

export interface NodePool {
    name: string
    count: number
    vmSize: string
    minCount?: number
    maxCount?: number
}
