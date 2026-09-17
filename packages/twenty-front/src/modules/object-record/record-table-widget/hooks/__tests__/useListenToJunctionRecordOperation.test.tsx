import { renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import {
  RecordTableWidgetContext,
  type RecordTableWidgetContextValue,
} from '@/object-record/record-table-widget/contexts/RecordTableWidgetContext';
import { useListenToJunctionRecordOperation } from '@/object-record/record-table-widget/hooks/useListenToJunctionRecordOperation';
import { notifyCustomerListAudienceChanged } from '@/activities/emails/utils/notifyCustomerListAudienceChanged';

jest.mock(
  '@/browser-event/hooks/useListenToObjectRecordOperationBrowserEvent',
  () => ({ useListenToObjectRecordOperationBrowserEvent: jest.fn() }),
);

describe('campaign list audience refresh', () => {
  it('refreshes only the matching list and removes its listener on unmount', () => {
    const onJunctionRecordOperation = jest.fn();
    const context = {
      junctionCreateThrough: {
        junctionObjectMetadataNameSingular: 'messageListMember',
        sourceRecordId: 'this-list',
      },
    } as RecordTableWidgetContextValue;
    const { unmount } = renderHook(
      () => useListenToJunctionRecordOperation({ onJunctionRecordOperation }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <RecordTableWidgetContext.Provider value={context}>
            {children}
          </RecordTableWidgetContext.Provider>
        ),
      },
    );
    notifyCustomerListAudienceChanged('another-list');
    expect(onJunctionRecordOperation).not.toHaveBeenCalled();
    notifyCustomerListAudienceChanged('this-list');
    expect(onJunctionRecordOperation).toHaveBeenCalledTimes(1);
    unmount();
    notifyCustomerListAudienceChanged('this-list');
    expect(onJunctionRecordOperation).toHaveBeenCalledTimes(1);
  });
});
