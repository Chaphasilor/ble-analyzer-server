function packet(originalPacket, format) {

  try {

    let info = getPacketInfo(originalPacket)

    switch (format) {
      case `full`:

        // return originalPacket._source
        return {...info,

        }

      case `raw`:

        return originalPacket._source

      default: // simple format

        return {
          malformed: info.malformed,
          packetId: info.packetId,
          microseconds: info.microseconds,
          isPartOfConnection: info.connection.isPartOfConnection,
          accessAddress: info.connection.accessAddress,
          type: info.type,
          source: info.source,
          destination: info.destination,
          protocols: info.protocols.map(protocol => protocol.name),
          length: info.length,
        }
      
    }
    
  } catch (err) {
    console.error(`Error while extracting packet info:`, err)
  }
  
}
module.exports.packet = packet

function connection(originalPacket) {

  try {
    
    let info = getPacketInfo(originalPacket)
    
    return !info.connection.isPartOfConnection ? false : {
      accessAddress: info.connection.accessAddress,
      master: info.connection.master,
      slave: info.connection.slave,
    } 
    
  } catch (err) {
    console.error(`Error while extracting packet info:`, err);
  }
  
}
module.exports.connection = connection

function getPacketInfo(originalPacket) {

  //TODO first determine type, then source & destination

  const primaryAdvertisingChannels = [37, 38, 39]
  
  let layers = originalPacket._source.layers
  let malformed
  let source = ``, destination = ``
  let type = `unknown`
  let direction = `unknown`
  let accessAddress
  let isPartOfConnection
  let master = ``, slave = ``
  let channel
  let packetId
  let microseconds
  let length
  let protocols

  malformed = layers[`_ws.malformed`] !== undefined
  channel = parseInt(layers.nordic_ble[`nordic_ble.channel`])
  packetId = parseInt(layers.frame[`frame.number`]),
  microseconds = parseInt(layers.frame[`frame.time_epoch`].slice(0, -3).split(`.`).join(``)),
  length = parseInt(layers.frame[`frame.len`])

  //TODO make sure all advertising packets (accessAddress 0x8e89bed6 should be the standard one) are not treated as a connection
  if (layers.btle[`btle.advertising_header`]) {

    switch (parseInt(layers.btle[`btle.advertising_header_tree`][`btle.advertising_header.pdu_type`].slice(-2), 16)) {
      case 0:
        type = `ADV_IND`
        break;
      case 1:
        type = `ADV_DIRECT_IND`
        break;
      case 2:
        type = `ADV_NONCONN_IND`
        break;
      case 3:
        type = primaryAdvertisingChannels.includes(channel) ? `SCAN_REQ` : `AUX_SCAN_REQ`
        break;
      case 4:
        type = `SCAN_RSP`
        break;
      case 5:
        type = primaryAdvertisingChannels.includes(channel) ? `CONNECT_IND` : `AUX_CONNECT_REQ`
        break;
      case 6:
        type = `ADV_SCAN_IND`
        break;
      case 7:
        type = primaryAdvertisingChannels.includes(channel) ? `ADV_EXT_IND` : `AUX_ADV_IND` // or `AUX_SCAN_RSP`, `AUX_SYNC_IND`, `AUX_CHAIN_IND`
        break;
      case 8:
        type = `AUX_CONNECT_RSP`
        break;
    
      default:
        type = `unknown`
        break;
    }
    
  }

  if (layers.btle[`btle.access_address`]) {
    accessAddress = layers.btle[`btle.access_address`]
  }

  isPartOfConnection = accessAddress && accessAddress !== `0x8e89bed6`

  if (isPartOfConnection) {
    
    master = layers.btle[`btle.master_bd_addr`]
    slave = layers.btle[`btle.slave_bd_addr`]
    direction =  layers.nordic_ble[`nordic_ble.flags_tree`][`nordic_ble.direction`] == "0" ? `S2M` : `M2S`
  }

  // determine source
  if (
    layers.btle[`btle.scanning_address`] ||
    layers.btle[`btle.advertising_address`] ||
    layers.btle[`btle.initiator_address`] 
  ) {

    source = layers.btle[`btle.scanning_address`] || layers.btle[`btle.initiator_address`] ||
    layers.btle[`btle.advertising_address`]

  } else if (isPartOfConnection) {
    
    source = direction === `S2M` ? layers.btle[`btle.slave_bd_addr`] : layers.btle[`btle.master_bd_addr`]
    
  } else {
    //TODO source for non-connection, non-advertising packets?
  }
  
  // determine destination
  if (isPartOfConnection) {
    destination = direction === `S2M` ? layers.btle[`btle.master_bd_addr`] : layers.btle[`btle.slave_bd_addr`]
  } else {
    //TODO destinations for non-connection packets?
  }

  protocols = layers.frame[`frame.protocols`].split(`:`).filter(x => x !== `btcommon`).map(protocolName => {

    switch (protocolName) {
      case `btle`:
        return {
          name: `BT LE Link Layer`,
          length: layers.btle[`btle.length`],
          accessAddress: layers.btle[`btle.access_address`],
          header: layers.btle[`btle.advertising_header_tree`] ? Object.entries(layers.btle[`btle.advertising_header_tree`]).reduce((obj, [key, value], index) => {
            obj[key.replace(`btle.advertising_header.`, ``)] = value
            return obj
          }, {}) : undefined,
          crc: layers.btle[`btle.crc`],
        }
        break;
    
      case `nordic_ble`:
        return {
          name: `Nordic BLE Sniffer`,
          length: layers.nordic_ble[`nordic_ble.len`],
          boardId: layers.nordic_ble[`nordic_ble.board_id`],
          flags: layers.nordic_ble[`nordic_ble.flags_tree`] ? Object.entries(layers.nordic_ble[`nordic_ble.flags_tree`]).reduce((obj, [key, value], index) => {
            obj[key.replace(`nordic_ble.`, ``)] = value
            return obj
          }, {}) : undefined,
          crc: layers.btle[`btle.crc`],
        }
        break;
    
      case `btl2cap`:
        return {
          name: `L2CAP`,
          length: Number(layers.btl2cap[`btl2cap.length`]),
          cid: Number(layers.btl2cap[`btl2cap.cid`]),
          payload: layers.btl2cap[`btl2cap.payload`]
        }
        break;
    
      case `btatt`:
        return {
          name: `ATT`,
          startingHandle: layers.btatt[`btatt.starting_handle`],
          endingHandle: layers.btatt[`btatt.ending_handle`],
          opcode: layers.btatt[`btatt.opcode_tree`] ? Object.entries(layers.btatt[`btatt.opcode_tree`]).reduce((obj, [key, value], index) => {
            obj[key.replace(`btatt.opcode.`, ``)] = value
            return obj
          }, {}) : undefined,
          uuid16: layers.btatt[`btatt.uuid16`],
        }
        break;
    
      case `btsmp`:
        return {
          name: `Security Manager`,
          opcode: layers.btsmp[`btsmp.opcode`],
          ioCapability: layers.btsmp[`btsmp.io_capability`],
          oobDataFlags: layers.btsmp[`btsmp.oob_data_flags`],
          authReq: layers.btsmp[`btsmp.authreq_tree`] ? Object.entries(layers.btsmp[`btsmp.authreq_tree`]).reduce((obj, [key, value], index) => {
            obj[key.replace(`btsmp.`, ``)] = value
            return obj
          }, {}) : undefined,
          maxEncryptionKeySize: layers.btsmp[`btsmp.max_enc_key_size`],
          initiatorKeyDistribution: layers.btsmp[`btsmp.initiator_key_distribution_tree`] ? Object.entries(layers.btsmp[`btsmp.initiator_key_distribution_tree`]).reduce((obj, [key, value], index) => {
            obj[key.replace(`btsmp.key_dist_`, ``)] = value
            return obj
          }, {}) : undefined,
          responderKeyDistribution: layers.btsmp[`btsmp.responder_key_distribution_tree`] ? Object.entries(layers.btsmp[`btsmp.responder_key_distribution_tree`]).reduce((obj, [key, value], index) => {
            obj[key.replace(`btsmp.key_dist_`, ``)] = value
            return obj
          }, {}) : undefined,
          randomValue: layers.btsmp[`btsmp.random_value`],
          confirmValue: layers.btsmp[`btsmp.cfm_value`],
        }
        break;

      default:
        return {
          name: `<unknown protocol> (${protocolName})`
        }
        break;
    }
    
  })

  //TODO prevent errors by checking if key exists

  return {
    malformed,
    packetId,
    microseconds,
    channel,
    type,
    connection: {
      isPartOfConnection,
      accessAddress,
      master,
      slave,
    },
    source,
    destination,
    protocols,
    length,
  }
  
}