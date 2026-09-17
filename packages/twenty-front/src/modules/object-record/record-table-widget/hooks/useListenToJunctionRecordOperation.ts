import { useListenToObjectRecordOperationBrowserEvent } from '@/browser-event/hooks/useListenToObjectRecordOperationBrowserEvent';
import { type ObjectRecordOperationBrowserEventDetail } from '@/browser-event/types/ObjectRecordOperationBrowserEventDetail';
import { RecordTableWidgetContext } from '@/object-record/record-table-widget/contexts/RecordTableWidgetContext';
import { useContext, useEffect } from 'react';
import { CUSTOMER_LIST_AUDIENCE_CHANGED } from '@/activities/emails/utils/notifyCustomerListAudienceChanged';
import { isDefined } from 'twenty-shared/utils';

// A junction widget's rows come and go with junction records, which are
// written on another object than the one the table lists.
export const useListenToJunctionRecordOperation = ({
  onJunctionRecordOperation,
}: {
  onJunctionRecordOperation: () => void;
}) => {
  const junctionCreateThrough = useContext(
    RecordTableWidgetContext,
  )?.junctionCreateThrough;

  useEffect(() => {
    if (
      junctionCreateThrough?.junctionObjectMetadataNameSingular !==
      'messageListMember'
    )
      return;
    const onAudienceChanged = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        event.detail === junctionCreateThrough.sourceRecordId
      ) {
        onJunctionRecordOperation();
      }
    };
    window.addEventListener(CUSTOMER_LIST_AUDIENCE_CHANGED, onAudienceChanged);
    return () =>
      window.removeEventListener(
        CUSTOMER_LIST_AUDIENCE_CHANGED,
        onAudienceChanged,
      );
  }, [junctionCreateThrough, onJunctionRecordOperation]);

  const handleJunctionRecordOperation = ({
    operation,
  }: ObjectRecordOperationBrowserEventDetail) => {
    if (!isDefined(junctionCreateThrough)) {
      return;
    }

    // Only operations carrying the written record can be scoped to the
    // widget's source record; the others may concern it, so they refresh.
    const writtenRecord =
      operation.type === 'create-one'
        ? operation.createdRecord
        : operation.type === 'restore-one'
          ? operation.restoredRecord
          : undefined;

    if (
      isDefined(writtenRecord) &&
      writtenRecord[junctionCreateThrough.sourceJoinColumnName] !==
        junctionCreateThrough.sourceRecordId
    ) {
      return;
    }

    onJunctionRecordOperation();
  };

  useListenToObjectRecordOperationBrowserEvent({
    onObjectRecordOperationBrowserEvent: handleJunctionRecordOperation,
    objectMetadataItemId: junctionCreateThrough?.junctionObjectMetadataId,
    enabled: isDefined(junctionCreateThrough),
  });
};
