export async function getK8sResourceGroup(
    resourceGroup: string,
    clusterName: string,
    location: string
): Promise<string> {
    return `MC_${resourceGroup}_${clusterName}_${location}`
}

export function getSubnetName(clusterName: string): string {
    return `${clusterName}-subnet`
}

/**
 * Get the VNET name to use for a given resource group that should host AKS clusters
 */
export function getVnetName(resourceGroup: string): string {
    return resourceGroup
}

/**
 * Get the name of the SP that is given to AKS to manage the Azure cluster resources
 */
export function getAksServicePrincipalName(resourceGroup: string): string {
    return `${resourceGroup}-sp`
}
