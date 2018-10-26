import * as aws from 'aws-sdk'
import { writeFileSync } from 'fs'

export async function saveKubeconfigToFile(awsConfig: aws.Config, clusterName: string, kubeConfigFile: string) {
    const eks = new aws.EKS({ ...awsConfig, apiVersion: '2017-11-01' })
    const cluster = (await eks.describeCluster({ name: clusterName }).promise()).cluster
    const kubeConfig = `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${cluster.certificateAuthority.data}
    server: ${cluster.endpoint}
  name: ${cluster.arn}
contexts:
- context:
    cluster: ${cluster.arn}
    user: ${cluster.arn}
  name: ${cluster.arn}
current-context: ${cluster.arn}
kind: Config
preferences: {}
users:
- name: ${cluster.arn}
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1alpha1
      args:
      - token
      - -i
      - ${cluster.name}
      command: aws-iam-authenticator
`
    writeFileSync(kubeConfigFile, kubeConfig)
}
