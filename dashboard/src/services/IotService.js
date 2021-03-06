import async from 'async';
import aws from 'aws-sdk';
import deviceSdk from 'aws-iot-device-sdk';

import AuthService from '@/services/AuthService';
import ConfigurationService from '@/services/ConfigurationService';

export default class IotService {

  constructor () {
    this.authService = AuthService.getInstance();
    this.configService = ConfigurationService.getInstance();

    const credentials = this.authService.getCredentials();
    const region = this.configService.get('AWS_REGION');
    this.iot = new aws.Iot({
      credentials, region
    });
  }

  connect () {
    const credentials = this.authService.getCredentials()
    this.iotData = new aws.IotData({
      endpoint: this.configService.get('IOT_ENDPOINT'),
      region: this.configService.get('AWS_REGION'),
      credentials
    })

    const req = {
      host: this.configService.get('IOT_ENDPOINT'),
      protocol: 'wss',
      clientId: 'ui' + new Date().getTime(),
      accessKeyId: credentials.accessKeyId,
      secretKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken
    }

    const device = deviceSdk.device(req)

    return device
  }

  async getAssetStatus (asset) {
    const thingName = asset;
    try {
      const data = await this.iotData.getThingShadow({ thingName }).promise();
      console.log('INFO: Successfully fecthed asset status');

      const parsedPayload = JSON.parse(data.payload);
      const state = parsedPayload.state.reported;
      const metadata = parsedPayload.metadata.reported;

      const mappedState = this.mapAssetState(state, metadata);
      mappedState.$metadata.timestamp = parsedPayload.timestamp;
      mappedState.$metadata.version = parsedPayload.version;

      return mappedState;
    } catch (e) {
      console.error('ERROR: Failed to fetch asset status');
      throw e;
    }
  }

  async getAllAssetStatus (assets) {
    return new Promise((resolve, reject) => {
      const tasks = assets.map(asset => cb => {
        this.getAssetStatus(asset)
          .then(data => cb(null, data))
          .catch(err => cb(err));
      });

      async.parallelLimit(tasks, 25, (err, data) => {
        if (err) {
          console.error('ERROR: Failed to fetch batch status');
          reject(err);
        } else {
          console.log('INFO: Successfully fetched batch status');
          resolve(data);
        }
      })
    });
  }

  mapAssetState (state, metadata) {
    
    const mappedState = Object.keys(state).map(key => {
      const item = state[key];
      const itemMetadata = metadata[key];

      if (typeof(item) === 'object' && !(item instanceof Array)) {
        return {
          key,
          value: this.mapAssetState(item, itemMetadata)
        }
      }

      return {
        key,
        value: item
      }
    }).reduce((total, item) => {
      const retItem = {};
      retItem[item.key] = item.value;

      return { ...total, ...retItem };
    }, {});

    mappedState.$metadata = metadata;

    return mappedState;
  }

  async prepareAccount () {
    return new Promise((resolve, reject) => {
      async.parallel([
        // Authorize myself
        cb => {
          const policyName = this.configService.get('PEOPLE_POLICY_NAME');
          const identityId = this.authService.getIdentity();

          this.iot.attachPolicy({
            policyName,
            target: identityId
          }, (err, data) => {
            if (err) {
              console.error('ERROR: Failed to grant access to iot broker');
              cb(err);
            } else {
              console.log('INFO: Successfully granted access to iot broker');
              cb(null, data);
            }
          })
        }
      ], (err, data) => {
        if (err) {
          console.error('ERROR: Failed to prepare account');
          reject(err);
        } else {
          console.log('INFO: Successfully prepared account');
          resolve(data);
        }
      })
    });
  }

  async provisionVirtualAsset (params) {
    return new Promise((resolve, reject) => {
      const thingTypeName = this.configService.get('VIRTUAL_VEHICLES_THING_TYPE');
      const thingName = params.vin;

      this.iot.createThing({
        thingName,
        thingTypeName,
        attributePayload: {
          attributes: {
            type: params.AssetType
          }
        }
      }, (err, data) => {
        if (err) {
          console.error('ERROR: Failed to provision virtual asset');
          reject(err);
        } else {
          console.log('INFO: Successfully provisioned virtual asset');
          resolve(data);
        }
      });
    });
  }

  async updateAssetStatus (asset, status) {
    const vin = asset.vin;

    return new Promise((resolve, reject) => {
      this.iotData.updateThingShadow({
        thingName: vin,
        payload: JSON.stringify({
          state: {
            reported: status
          }
        })
      }, (err, data) => {
        if (err) {
          console.error('ERROR: Failed to update asset status');
          reject(err);
        } else {
          console.log('INFO: Successfully updated asset status');
          resolve(data);
        }
      })
    });
  }

  static getInstance () {
    if (!IotService._instance) IotService._instance = new IotService()
    return IotService._instance
  }
}
