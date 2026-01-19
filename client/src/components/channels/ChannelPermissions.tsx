/**
 * ChannelPermissions - Channel-specific permission overrides
 *
 * Stub component - will be implemented in Task 7.
 */

import { Component } from "solid-js";

interface ChannelPermissionsProps {
  channelId: string;
  guildId: string;
}

const ChannelPermissions: Component<ChannelPermissionsProps> = (props) => {
  return (
    <div class="p-6">
      <p class="text-text-secondary text-sm">
        Channel permissions for {props.channelId} will be implemented in Task 7.
      </p>
    </div>
  );
};

export default ChannelPermissions;
