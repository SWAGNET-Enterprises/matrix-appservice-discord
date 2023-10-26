/*
Copyright 2018, 2019 matrix-appservice-discord

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import * as Discord from "@mx-puppet/better-discord.js";
import { DbRoomStore, RemoteStoreRoom, MatrixStoreRoom } from "./db/roomstore";
import { ChannelSyncroniser } from "./channelsyncroniser";
import { Log } from "./log";

const PERMISSION_REQUEST_TIMEOUT = 300000; // 5 minutes

const log = new Log("Provisioner");

export class Provisioner {

    private pendingRequests: Map<string, any> = new Map(); // [channelId]: resolver fn

    constructor(private roomStore: DbRoomStore, private channelSync: ChannelSyncroniser) { }

    public async BridgeMatrixRoom(channel: Discord.TextChannel, roomId: string) {
        const remote = new RemoteStoreRoom(`discord_${channel.guild.id}_${channel.id}_bridged`, {
            discord_channel: channel.id,
            discord_guild: channel.guild.id,
            discord_type: "text",
            plumbed: true,
        });
        const local = new MatrixStoreRoom(roomId);
        return this.roomStore.linkRooms(local, remote);
    }

    /**
     * Returns if the room count limit has been reached.
     * This can be set by the bridge admin and prevents new rooms from being bridged.
     * @returns Has the limit been reached?
     */
    public async RoomCountLimitReached(limit: number): Promise<boolean> {
        return limit >= 0 && await this.roomStore.countEntries() >= limit;
    }

    public async UnbridgeChannel(channel: Discord.TextChannel, rId?: string) {
        const roomsRes = await this.roomStore.getEntriesByRemoteRoomData({
            discord_channel: channel.id,
            discord_guild: channel.guild.id,
            plumbed: true,
        });
        if (roomsRes.length === 0) {
            throw Error("Channel is not bridged");
        }
        const remoteRoom = roomsRes[0].remote as RemoteStoreRoom;
        let roomsToUnbridge: string[] = [];
        if (rId) {
            roomsToUnbridge = [rId];
        } else {
            // Kill em all.
            roomsToUnbridge = roomsRes.map((entry) => entry.matrix!.roomId);
        }
        await Promise.all(roomsToUnbridge.map( async (roomId) => {
            try {
                await this.channelSync.OnUnbridge(channel, roomId);
            } catch (ex) {
                log.error(`Failed to cleanly unbridge ${channel.id} ${channel.guild} from ${roomId}`, ex);
            }
        }));
        await this.roomStore.removeEntriesByRemoteRoomId(remoteRoom.getId());
    }

}
