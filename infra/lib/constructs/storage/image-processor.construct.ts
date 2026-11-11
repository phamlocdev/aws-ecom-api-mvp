import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3n from 'aws-cdk-lib/aws-s3-notifications'
import { Construct } from 'constructs'
import { createNodejsBundling, sourceEntryPath } from '../../shared/lambda-bundling'

export interface ImageProcessorConstructProps {
  mediaBucket: s3.IBucket
}

export class ImageProcessorConstruct extends Construct {
  readonly handler: nodejs.NodejsFunction

  constructor(scope: Construct, id: string, props: ImageProcessorConstructProps) {
    super(scope, id)
    this.handler = new nodejs.NodejsFunction(this, 'Handler', {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.X86_64,
      entry: sourceEntryPath('workers', 'image-processor.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      bundling: createNodejsBundling({
        nodeModules: ['sharp'],
        forceDockerBundling: true,
        preCompilation: false,
        afterBundling: (_inputDir, outputDir) => [`rm -rf ${outputDir}/node_modules/.bin`],
      }),
      environment: {
        MEDIA_BUCKET_NAME: props.mediaBucket.bucketName,
      },
    })

    props.mediaBucket.grantReadWrite(this.handler)

    props.mediaBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(this.handler),
      { prefix: 'products/' },
    )
    props.mediaBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(this.handler),
      { prefix: 'users/' },
    )
  }
}
