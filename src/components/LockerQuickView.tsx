import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { formatBatchIntake } from "@/lib/locker-utils";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

interface Props {
  locker: Locker | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: () => void;
  canEdit?: boolean;
}

/**
 * Read-only, structured quick-view of a locker. Opens as a bottom drawer
 * (works equally well on mobile and desktop) so long remarks, badge / NID,
 * and location data are fully readable without horizontal scrolling.
 */
export function LockerQuickView({ locker, open, onOpenChange, onEdit, canEdit }: Props) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92vh]">
        {locker ? (
          <>
            <DrawerHeader className="text-left">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <DrawerTitle className="font-display text-2xl">
                    Locker {locker.locker_number}
                  </DrawerTitle>
                  <DrawerDescription>
                    {locker.location}
                    {locker.row_label ? ` · Row ${locker.row_label}` : ""}
                  </DrawerDescription>
                </div>
                <StatusBadge status={locker.status} />
              </div>
            </DrawerHeader>

            <div className="px-4 pb-2 space-y-5 overflow-y-auto">
              <Section title="Locker">
                <Item label="Unit Type" value={locker.unit_type} />
                <Item label="Key Lock" value={locker.key_lock} />
                <Item label="Batch Intake" value={formatBatchIntake(locker.batch_intake)} />
                <Item label="Spare Key" value={locker.spare_key_status} />
              </Section>

              <Section title="Assignment">
                <Item label="Employee Name" value={locker.employee_name} wide />
                <Item label="Badge Number" value={locker.badge_number} mono />
                <Item label="National ID" value={locker.national_id} mono />
                <Item label="Work Location" value={locker.work_location} wide />
              </Section>

              <Section title="Remark">
                <div className="col-span-2">
                  {locker.remark ? (
                    <p className="text-sm whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 leading-relaxed">
                      {locker.remark}
                    </p>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">No remark</p>
                  )}
                </div>
              </Section>
            </div>

            <DrawerFooter className="flex-row justify-end gap-2">
              {canEdit && onEdit && (
                <Button onClick={onEdit}>Edit / Manage</Button>
              )}
              <DrawerClose asChild>
                <Button variant="outline">Close</Button>
              </DrawerClose>
            </DrawerFooter>
          </>
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function Item({
  label,
  value,
  wide,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  wide?: boolean;
  mono?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-sm font-medium break-words ${mono ? "font-mono" : ""}`}
      >
        {value && value.trim() !== "" ? (
          value
        ) : (
          <span className="text-muted-foreground italic font-normal">—</span>
        )}
      </div>
    </div>
  );
}
