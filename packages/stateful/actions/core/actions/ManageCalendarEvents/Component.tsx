import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  FormSwitchCard,
  InputErrorMessage,
  InputLabel,
  NumericInput,
  SegmentedControlsTitle,
  TextAreaInput,
  TextInput,
  useActionOptions,
} from '@dao-dao/stateless'
import { ActionComponent } from '@dao-dao/types/actions'
import {
  makeValidateAddress,
  validatePositive,
  validateRequired,
} from '@dao-dao/utils'

export type ManageCalendarEventsMode = 'create' | 'update' | 'cancel'

export type ManageCalendarEventsData = {
  mode: ManageCalendarEventsMode
  /** dao-calendar contract address */
  calendarContract: string
  // create
  title: string
  description: string
  /** datetime-local string or ISO */
  startTime: string
  endTime: string
  /** Comma-separated group ids */
  managingGroups: string
  timezone: string
  // update / cancel
  eventId: number
  /**
   * EN-F6: also write mesh.v1.bounties.boards entry (set_item) so Bounties
   * module can tab this event board.
   */
  registerBountyBoard: boolean
  /**
   * Board key when on-chain event id is not yet known (create). Defaults to
   * slugified title. On update, defaults to String(eventId).
   */
  bountyBoardEventId: string
}

export const ManageCalendarEventsComponent: ActionComponent<
  undefined,
  ManageCalendarEventsData
> = ({ fieldNamePrefix, errors, isCreating }) => {
  const { t } = useTranslation()
  const {
    chain: { bech32Prefix },
  } = useActionOptions()
  const { register, watch, setValue, getValues } =
    useFormContext<ManageCalendarEventsData>()

  const mode = watch((fieldNamePrefix + 'mode') as 'mode')
  const registerBountyBoard = watch(
    (fieldNamePrefix + 'registerBountyBoard') as 'registerBountyBoard'
  )

  return (
    <>
      <SegmentedControlsTitle
        className="mb-2"
        editable={isCreating}
        fieldName={(fieldNamePrefix + 'mode') as 'mode'}
        tabs={[
          {
            label: t('button.create', { defaultValue: 'Create' }),
            value: 'create',
          },
          {
            label: t('button.update', { defaultValue: 'Update' }),
            value: 'update',
          },
          {
            label: t('button.cancel', { defaultValue: 'Cancel' }),
            value: 'cancel',
          },
        ]}
      />

      <div className="flex flex-col gap-1">
        <InputLabel
          name={t('form.calendarContract', {
            defaultValue: 'Calendar contract',
          })}
          tooltip={t('form.calendarContractTooltip', {
            defaultValue:
              'dao-calendar address for this DAO (from Calendar module or mesh.v1).',
          })}
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.calendarContract}
          fieldName={(fieldNamePrefix + 'calendarContract') as 'calendarContract'}
          register={register}
          validation={[
            validateRequired,
            makeValidateAddress(bech32Prefix, false),
          ]}
        />
        <InputErrorMessage error={errors?.calendarContract} />
      </div>

      {(mode === 'update' || mode === 'cancel') && (
        <div className="flex flex-col gap-1">
          <InputLabel
            name={t('form.eventId', { defaultValue: 'Event ID' })}
          />
          <NumericInput
            disabled={!isCreating}
            error={errors?.eventId}
            fieldName={(fieldNamePrefix + 'eventId') as 'eventId'}
            getValues={getValues}
            min={1}
            numericValue
            register={register}
            setValue={setValue}
            sizing="fill"
            step={1}
            validation={[validateRequired, validatePositive]}
          />
          <InputErrorMessage error={errors?.eventId} />
        </div>
      )}

      {mode === 'cancel' && (
        <p className="secondary-text text-sm">
          {t('info.cancelCalendarEventHint', {
            defaultValue:
              'Cancels the event on-chain. Query plane (headstash) may lag briefly after execution.',
          })}
        </p>
      )}

      {(mode === 'create' || mode === 'update') && (
        <>
          <div className="flex flex-col gap-1">
            <InputLabel name={t('form.title', { defaultValue: 'Title' })} />
            <TextInput
              disabled={!isCreating}
              error={errors?.title}
              fieldName={(fieldNamePrefix + 'title') as 'title'}
              register={register}
              validation={mode === 'create' ? [validateRequired] : []}
            />
            <InputErrorMessage error={errors?.title} />
          </div>

          <div className="flex flex-col gap-1">
            <InputLabel
              name={t('form.description', { defaultValue: 'Description' })}
            />
            <TextAreaInput
              disabled={!isCreating}
              error={errors?.description}
              fieldName={(fieldNamePrefix + 'description') as 'description'}
              register={register}
              rows={2}
            />
            <InputErrorMessage error={errors?.description} />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="flex grow flex-col gap-1">
              <InputLabel
                name={t('form.startTime', { defaultValue: 'Start' })}
              />
              <TextInput
                disabled={!isCreating}
                error={errors?.startTime}
                fieldName={(fieldNamePrefix + 'startTime') as 'startTime'}
                placeholder="YYYY-MM-DDTHH:mm"
                register={register}
                type="datetime-local"
                validation={mode === 'create' ? [validateRequired] : []}
              />
              <InputErrorMessage error={errors?.startTime} />
            </div>
            <div className="flex grow flex-col gap-1">
              <InputLabel name={t('form.endTime', { defaultValue: 'End' })} />
              <TextInput
                disabled={!isCreating}
                error={errors?.endTime}
                fieldName={(fieldNamePrefix + 'endTime') as 'endTime'}
                placeholder="YYYY-MM-DDTHH:mm"
                register={register}
                type="datetime-local"
                validation={mode === 'create' ? [validateRequired] : []}
              />
              <InputErrorMessage error={errors?.endTime} />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <InputLabel
              name={t('form.managingGroups', {
                defaultValue: 'Managing groups',
              })}
              tooltip={t('form.managingGroupsTooltip', {
                defaultValue:
                  'Comma-separated group ids registered on the calendar (e.g. core,gov).',
              })}
            />
            <TextInput
              disabled={!isCreating}
              error={errors?.managingGroups}
              fieldName={
                (fieldNamePrefix + 'managingGroups') as 'managingGroups'
              }
              placeholder="core"
              register={register}
              validation={mode === 'create' ? [validateRequired] : []}
            />
            <InputErrorMessage error={errors?.managingGroups} />
          </div>

          <div className="flex flex-col gap-1">
            <InputLabel
              name={t('form.timezone', { defaultValue: 'Timezone' })}
            />
            <TextInput
              disabled={!isCreating}
              error={errors?.timezone}
              fieldName={(fieldNamePrefix + 'timezone') as 'timezone'}
              placeholder="America/New_York"
              register={register}
            />
            <InputErrorMessage error={errors?.timezone} />
          </div>

          <p className="secondary-text text-xs">
            {t('info.calendarWriteIndexLag', {
              defaultValue:
                'Writes are on-chain via this proposal. The Connect query plane may take a short time to index the event.',
            })}
          </p>

          <FormSwitchCard
            containerClassName="self-start"
            fieldName={
              (fieldNamePrefix +
                'registerBountyBoard') as 'registerBountyBoard'
            }
            label={t('form.registerBountyBoard', {
              defaultValue: 'Register bounty board on mesh.v1',
            })}
            readOnly={!isCreating}
            setValue={setValue}
            sizing="sm"
            tooltip={t('form.registerBountyBoardTooltip', {
              defaultValue:
                'Adds this event to mesh.v1.bounties.boards so the Bounties tab can switch boards. Uses text-record/storage key mesh.v1 only (EN-F6). Does not create rows in zec-bounties API — apply/submit stay EN-B1 ADR-36.',
            })}
            tooltipIconSize="sm"
            value={!!registerBountyBoard}
          />

          {registerBountyBoard && (
            <div className="flex flex-col gap-1">
              <InputLabel
                name={t('form.bountyBoardEventId', {
                  defaultValue: 'Board event id',
                })}
                tooltip={t('form.bountyBoardEventIdTooltip', {
                  defaultValue:
                    'Stable key for the board tab and embed ?eventId=. On create, calendar numeric id is not known yet — use a slug (default: title). On update, defaults to the event id.',
                })}
              />
              <TextInput
                disabled={!isCreating}
                error={errors?.bountyBoardEventId}
                fieldName={
                  (fieldNamePrefix +
                    'bountyBoardEventId') as 'bountyBoardEventId'
                }
                placeholder={
                  mode === 'update'
                    ? String(
                        watch((fieldNamePrefix + 'eventId') as 'eventId') || ''
                      )
                    : 'hack-night'
                }
                register={register}
              />
              <InputErrorMessage error={errors?.bountyBoardEventId} />
            </div>
          )}
        </>
      )}
    </>
  )
}
